import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { ImportErrorEntry } from '../dto/imports/import-log-response.dto';

import type {
  ImportResult,
  ImportStrategy,
  ImportStrategyArgs,
} from './import-strategy.interface';

/**
 * Wave 3 / Tracker Phase 5 part 3 (2026-05-24) — импорт из Битрикс24
 * (Bitrix24) через REST API по входящему вебхуку:
 *
 *   `https://{portal}.bitrix24.ru/rest/{userId}/{token}/{method}.json`
 *
 * Авторизация: единственным источником прав является сам URL — токен лежит
 * в path. Никаких заголовков Authorization не нужно. Гранулярность прав
 * ограничена тем, что вебхук создавали администратору портала: если у
 * webhook'а нет права task/disk — пользователю API вернёт 401/403, мы
 * считаем это фатальной ошибкой импорта и поднимаем исключение (worker
 * сделает finalizeFailed).
 *
 * Что мапим (см. plans/tz/2026-05-23-tracker-phase-5-import.md §Битрикс24 → Кора):
 *   sonet_group (рабочая группа)  → Project (name=group.NAME, identifier=
 *                                   эвристически из имени, slug из имени)
 *   task.STATUS                    → IssueState (mapStatusCategory)
 *     1=Новая, 2=Ждёт выполнения, 3=Выполняется, 4=Ожидает контроля,
 *     5=Завершена, 6=Отложена, 7=Отказ
 *   tasks.task.list item           → Issue (title=TITLE, description=
 *                                   DESCRIPTION, externalSource='bitrix24',
 *                                   externalId=task.ID)
 *   RESPONSIBLE_ID (+ user.get →
 *     email)                       → IssueAssignee (через userMappings)
 *   CREATED_BY                     → Issue.createdById (через userMappings,
 *                                   fallback = инициатор импорта)
 *   DEADLINE                       → Issue.dueDate
 *   PRIORITY                       → Issue.priority (0=low, 1=medium, 2=urgent)
 *   PARENT_ID                      → Issue.parentId (вторым проходом)
 *   DEPENDS_ON                     → IssueRelation (blocked_by)
 *   task.commentitem.getlist       → IssueComment
 *   disk attachments               → IssueAttachment (best-effort через
 *                                   `disk.file.get` + DOWNLOAD_URL → S3)
 *
 * Идемпотентность: перед созданием Issue — `findFirst({ tenantId,
 * externalSource: 'bitrix24', externalId: task.ID })`. Если есть — skip.
 *
 * Cancellation: каждые 50 items перечитываем `ImportLog.status`; если
 * 'cancelled' — выходим с частичными счётчиками.
 *
 * Rate limiting: при 429/5xx — exp backoff (1s, 2s, 4s, max 16s, до 4
 * попыток). На 4xx (кроме 429) — бросаем сразу. 401 при первом запросе
 * (валидация вебхука) — пробрасываем дальше, чтобы воркер отметил failed.
 *
 * NB: Битрикс24 REST имеет soft rate limit ~2 RPS на портал. Мы ничего
 * не throttle'ем заранее — полагаемся на 429+backoff, обычно дешевле
 * упереться один раз и подождать секунду, чем sleep между всеми запросами.
 */
@Injectable()
export class Bitrix24ImportStrategy implements ImportStrategy {
  private readonly logger = new Logger(Bitrix24ImportStrategy.name);

  /** Каждые сколько items проверяем cancellation + эмитим progress. */
  private static readonly PROGRESS_BATCH_SIZE = 50;

  /** Max attachments fetch размер (соответствует attachments.service / Trello). */
  private static readonly MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

  /** Таймаут одного HTTP-запроса. */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  /** Max попыток при 429/5xx. */
  private static readonly MAX_RETRY_ATTEMPTS = 4;

  /** Per-page для list-эндпоинтов (Битрикс24 max ~50). */
  private static readonly PAGE_SIZE = 50;

  async run(args: ImportStrategyArgs): Promise<ImportResult> {
    const { importLog, params, services, onProgress } = args;
    const tenantId = importLog.tenantId;
    const tenantTop = tenantTopOf(tenantId);
    const userId = importLog.initiatedByUserId;

    const webhookUrl = String(params.webhookUrl ?? '').trim();
    const selectedGroupIdsRaw = Array.isArray(params.selectedGroupIds)
      ? (params.selectedGroupIds as Array<string | number>)
      : [];
    const selectedGroupIds = selectedGroupIdsRaw
      .map((g) => String(g).trim())
      .filter((g) => g.length > 0);
    const userMappings = (params.userMappings ?? {}) as Record<
      string,
      string | null
    >;

    if (!webhookUrl) {
      throw new Error('Bitrix24 import: webhookUrl не задан');
    }
    if (selectedGroupIds.length === 0) {
      throw new Error(
        'Bitrix24 import: selectedGroupIds пуст — нечего импортировать',
      );
    }

    const errors: ImportErrorEntry[] = [];
    const result: ImportResult = {
      totalProjects: 0,
      totalIssues: 0,
      totalComments: 0,
      totalAttachments: 0,
      unmatchedEmails: [],
      errors,
    };

    const client = new Bitrix24Client({
      webhookUrl,
      logger: this.logger,
      fetchImpl: (input, init) =>
        fetch(input as unknown as string, init as unknown as RequestInit),
    });

    const unmatchedEmails = new Set<string>();
    let processedItems = 0;

    // ── 1) Загружаем группы + задачи постранично, чтобы знать total и
    //      иметь возможность разрулить parent/depends внутри одного импорта.
    type LoadedGroup = {
      group: BitrixGroup;
      tasks: BitrixTask[];
    };
    const loaded: LoadedGroup[] = [];
    for (const groupId of selectedGroupIds) {
      try {
        const group = await client.getGroup(groupId);
        const tasks = await client.listTasksByGroup(groupId);
        loaded.push({ group, tasks });
      } catch (err) {
        // 401 на первом же вебхук-вызове — считаем фатальным.
        if (err instanceof BitrixApiError && err.status === 401) {
          throw new Error(
            `Bitrix24 import: webhook не авторизован (HTTP 401). Проверьте, что URL вебхука актуален и у него есть права на task и sonet_group.`,
            { cause: err },
          );
        }
        errors.push({
          stage: 'group',
          externalId: groupId,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }

    const totalTasks = loaded.reduce((sum, g) => sum + g.tasks.length, 0);

    // Карта `bitrix task.ID` → `our Issue.id` (для parent + relations).
    const issueIdByBitrixId = new Map<string, string>();

    // Кэш user.get по userId → email (для assignee resolve).
    const emailByBitrixUserId = new Map<string, string | null>();

    // ── 2) Импортируем по группам.
    for (const { group, tasks } of loaded) {
      let project: { id: string; identifier: string };
      // Status (числовой) → our IssueState.id. Битрикс24 имеет фиксированные
      // 1..7 (не workflow per group), но мы создаём свой набор state per project,
      // потому что у каждого Project в Коре есть свои IssueState'ы.
      let stateByBitrixStatus: Map<string, string>;
      try {
        project = await this.upsertProject({
          tenantId,
          group,
          userId,
          services,
        });
        result.totalProjects += 1;

        stateByBitrixStatus = await this.createStatesForGroup({
          tenantId,
          projectId: project.id,
          services,
        });
      } catch (err) {
        errors.push({
          stage: 'group',
          externalId: group.ID ?? null,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      for (const task of tasks) {
        // Cancellation + progress каждые 50 items.
        if (
          processedItems > 0 &&
          processedItems % Bitrix24ImportStrategy.PROGRESS_BATCH_SIZE === 0
        ) {
          const wasCancelled = await this.isCancelled({
            importLogId: importLog.id,
            services,
          });
          if (wasCancelled) {
            this.logger.warn(
              { importLogId: importLog.id },
              'bitrix24-import: импорт отменён пользователем — выход',
            );
            result.unmatchedEmails = Array.from(unmatchedEmails);
            this.trimErrors(errors);
            return result;
          }
          await services.prisma.importLog
            .update({
              where: { id: importLog.id },
              data: { processedItems },
            })
            .catch(() => undefined);
          await onProgress({
            processed: processedItems,
            total: totalTasks,
            phase: 'issues',
          });
        }

        try {
          const outcome = await this.importTask({
            tenantId,
            project,
            task,
            stateByBitrixStatus,
            userMappings,
            unmatchedEmails,
            emailByBitrixUserId,
            userId,
            client,
            services,
            errors,
          });
          if (outcome.created) {
            result.totalIssues += 1;
            result.totalComments += outcome.comments;
            result.totalAttachments += outcome.attachments;
          }
          if (outcome.ourIssueId) {
            issueIdByBitrixId.set(String(task.ID), outcome.ourIssueId);
          }
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'task',
              externalId: task.ID ? String(task.ID) : null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }

        processedItems += 1;
        services.metrics?.incImportIssueProcessed({
          tenantTop,
          source: 'bitrix24',
        });
      }
    }

    // ── 3) Вторым проходом — связи (parent + depends), потому что они
    //      требуют, чтобы все импортируемые Issue уже существовали.
    for (const { tasks } of loaded) {
      for (const task of tasks) {
        const ourId = issueIdByBitrixId.get(String(task.ID));
        if (!ourId) continue;
        try {
          await this.linkParent({
            task,
            ourIssueId: ourId,
            issueIdByBitrixId,
            services,
          });
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'parent',
              externalId: task.ID ? String(task.ID) : null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
        try {
          await this.linkDepends({
            task,
            ourIssueId: ourId,
            issueIdByBitrixId,
            userId,
            services,
          });
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'depends',
              externalId: task.ID ? String(task.ID) : null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    }

    // Финализация.
    result.unmatchedEmails = Array.from(unmatchedEmails);
    this.trimErrors(errors);
    await services.prisma.importLog
      .update({
        where: { id: importLog.id },
        data: {
          processedItems,
          unmatchedJson:
            result.unmatchedEmails as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
    await onProgress({
      processed: processedItems,
      total: totalTasks,
      phase: 'finalizing',
    });
    return result;
  }

  // ─────────────────────────── per-task ───────────────────────────────────

  /**
   * Создаёт Issue + комментарии + вложения. Возвращает `created=false`,
   * если Issue с (tenantId, externalSource='bitrix24', externalId) уже
   * существует — тогда мы skip'аем целиком.
   */
  private async importTask(args: {
    tenantId: string;
    project: { id: string; identifier: string };
    task: BitrixTask;
    stateByBitrixStatus: Map<string, string>;
    userMappings: Record<string, string | null>;
    unmatchedEmails: Set<string>;
    emailByBitrixUserId: Map<string, string | null>;
    userId: string;
    client: Bitrix24Client;
    services: ImportStrategyArgs['services'];
    errors: ImportErrorEntry[];
  }): Promise<{
    created: boolean;
    ourIssueId: string | null;
    comments: number;
    attachments: number;
  }> {
    const {
      tenantId,
      project,
      task,
      stateByBitrixStatus,
      userMappings,
      unmatchedEmails,
      emailByBitrixUserId,
      userId,
      client,
      services,
      errors,
    } = args;

    const taskId = String(task.ID);

    // Идемпотентность.
    const existing = await services.prisma.issue.findFirst({
      where: {
        tenantId,
        externalSource: 'bitrix24',
        externalId: taskId,
      },
      select: { id: true },
    });
    if (existing) {
      return {
        created: false,
        ourIssueId: existing.id,
        comments: 0,
        attachments: 0,
      };
    }

    // Resolve assignee (RESPONSIBLE_ID → email через user.get → mapping).
    const responsibleId =
      task.RESPONSIBLE_ID != null ? String(task.RESPONSIBLE_ID) : null;
    let assigneeUserId: string | null = null;
    if (responsibleId) {
      const email = await this.resolveEmail({
        bitrixUserId: responsibleId,
        client,
        cache: emailByBitrixUserId,
      });
      if (email) {
        if (email in userMappings) {
          assigneeUserId = userMappings[email] ?? null;
        } else {
          unmatchedEmails.add(email);
        }
      }
    }

    // Resolve creator (CREATED_BY → email → mapping). Fallback = инициатор импорта.
    const createdBy = task.CREATED_BY != null ? String(task.CREATED_BY) : null;
    let creatorUserId = userId;
    if (createdBy) {
      const email = await this.resolveEmail({
        bitrixUserId: createdBy,
        client,
        cache: emailByBitrixUserId,
      });
      if (email) {
        if (email in userMappings) {
          creatorUserId = userMappings[email] ?? userId;
        } else {
          unmatchedEmails.add(email);
        }
      }
    }

    const stateKey = task.STATUS != null ? String(task.STATUS) : '';
    const stateId = stateKey ? (stateByBitrixStatus.get(stateKey) ?? null) : null;

    const priority = mapPriority(task.PRIORITY);
    const dueDate = task.DEADLINE ? safeParseDate(task.DEADLINE) : null;
    const description = sanitizeDescription(task.DESCRIPTION);

    // Создание Issue в транзакции с пересчётом sequenceId.
    const created = await services.prisma.$transaction(async (tx) => {
      const maxRow = await tx.issue.aggregate({
        where: { projectId: project.id },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const identifier = `${project.identifier}-${sequenceId}`;

      const row = await tx.issue.create({
        data: {
          tenantId,
          projectId: project.id,
          identifier,
          sequenceId,
          title: (task.TITLE ?? '').slice(0, 500) || '(без названия)',
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority,
          stateId,
          sortOrder: 0,
          dueDate,
          externalSource: 'bitrix24',
          externalId: taskId,
          createdById: creatorUserId,
          createdManually: false,
        },
        select: { id: true },
      });

      if (assigneeUserId) {
        await tx.issueAssignee
          .create({
            data: {
              issueId: row.id,
              userId: assigneeUserId,
              assignedById: userId,
            },
          })
          .catch(() => undefined);
      }
      return row;
    });

    // Comments.
    let commentsCount = 0;
    try {
      const comments = await client.getTaskComments(taskId);
      for (const c of comments) {
        try {
          const authorBitrixId =
            c.AUTHOR_ID != null ? String(c.AUTHOR_ID) : null;
          let authorId = userId;
          if (authorBitrixId) {
            const email = await this.resolveEmail({
              bitrixUserId: authorBitrixId,
              client,
              cache: emailByBitrixUserId,
            });
            if (email) {
              if (email in userMappings) {
                authorId = userMappings[email] ?? userId;
              } else {
                unmatchedEmails.add(email);
              }
            }
          }
          const text = (sanitizeDescription(c.POST_MESSAGE) ?? '').slice(
            0,
            50_000,
          );
          if (!text.trim()) continue;
          await services.prisma.issueComment.create({
            data: {
              issueId: created.id,
              authorId,
              content: text,
              contentHtml: null,
              contentStripped: text,
              access: 'internal',
              createdAt: c.POST_DATE
                ? (safeParseDate(c.POST_DATE) ?? new Date())
                : new Date(),
            },
          });
          commentsCount += 1;
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'comment',
              externalId: c.ID != null ? String(c.ID) : null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    } catch (err) {
      errors.push(
        this.cap(errors, {
          stage: 'comments',
          externalId: taskId,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // Attachments (best-effort через UF_TASK_WEBDAV_FILES → disk.file.get).
    let attachmentsCount = 0;
    const fileIds = collectAttachmentFileIds(task);
    for (const fileId of fileIds) {
      try {
        const ok = await this.downloadAttachment({
          fileId,
          issueId: created.id,
          uploaderId: userId,
          client,
          services,
        });
        if (ok) attachmentsCount += 1;
      } catch (err) {
        errors.push(
          this.cap(errors, {
            stage: 'attachment',
            externalId: fileId,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    return {
      created: true,
      ourIssueId: created.id,
      comments: commentsCount,
      attachments: attachmentsCount,
    };
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  private async isCancelled(args: {
    importLogId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<boolean> {
    const row = await args.services.prisma.importLog.findUnique({
      where: { id: args.importLogId },
      select: { status: true },
    });
    return row?.status === 'cancelled';
  }

  /**
   * user.get запрос с кешем. Возвращает первый непустой email пользователя
   * (lowercase, trimmed). null — если такой user отсутствует / без email /
   * запрос упал. Не бросает исключений (лог + null).
   */
  private async resolveEmail(args: {
    bitrixUserId: string;
    client: Bitrix24Client;
    cache: Map<string, string | null>;
  }): Promise<string | null> {
    const { bitrixUserId, client, cache } = args;
    if (cache.has(bitrixUserId)) return cache.get(bitrixUserId) ?? null;
    try {
      const user = await client.getUser(bitrixUserId);
      const email = (user?.EMAIL ?? '').toString().toLowerCase().trim();
      const normalized = email || null;
      cache.set(bitrixUserId, normalized);
      return normalized;
    } catch (err) {
      this.logger.warn(
        {
          bitrixUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'bitrix24-import: user.get failed — fallback null email',
      );
      cache.set(bitrixUserId, null);
      return null;
    }
  }

  /**
   * Создаёт Project из Битрикс24 sonet_group. Identifier эвристически по
   * имени; при коллизии — добавляем nanoid-суффикс.
   */
  private async upsertProject(args: {
    tenantId: string;
    group: BitrixGroup;
    userId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<{ id: string; identifier: string }> {
    const { tenantId, group, userId, services } = args;
    const groupName = (group.NAME ?? '').toString().trim() || 'Группа';

    const slugBase = slugify(groupName) || 'imported';
    const identifierBase = makeIdentifier(groupName);

    let slug = slugBase;
    let identifier = identifierBase;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await services.prisma.project.findFirst({
        where: { tenantId, OR: [{ slug }, { identifier }] },
        select: { id: true },
      });
      if (!existing) break;
      const suffix = nanoid(4).toLowerCase();
      slug = `${slugBase}-${suffix}`;
      identifier = `${identifierBase.slice(0, 3)}${suffix.slice(0, 2).toUpperCase()}`;
    }

    const created = await services.prisma.project.create({
      data: {
        tenantId,
        slug,
        identifier,
        name: groupName,
        description: (group.DESCRIPTION ?? '').toString().slice(0, 1_000) || null,
        ownerId: userId,
        timezone: 'Europe/Moscow',
        network: 0,
      },
      select: { id: true, identifier: true },
    });

    await services.prisma.projectMember
      .create({
        data: { projectId: created.id, userId, role: 20 },
      })
      .catch(() => undefined);

    return created;
  }

  /**
   * Создаёт фиксированный набор IssueState под Битрикс24 STATUS 1..7.
   * Возвращает map "1|2|3|...|7" → IssueState.id.
   */
  private async createStatesForGroup(args: {
    tenantId: string;
    projectId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<Map<string, string>> {
    const { tenantId, projectId, services } = args;
    const stateByKey = new Map<string, string>();
    // Канонические Битрикс24-статусы.
    const defs: Array<{
      key: string;
      name: string;
      category: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
      isDefault: boolean;
    }> = [
      { key: '1', name: 'Новая', category: 'unstarted', isDefault: true },
      { key: '2', name: 'Ждёт выполнения', category: 'unstarted', isDefault: false },
      { key: '3', name: 'Выполняется', category: 'started', isDefault: false },
      { key: '4', name: 'Ожидает контроля', category: 'started', isDefault: false },
      { key: '5', name: 'Завершена', category: 'completed', isDefault: false },
      { key: '6', name: 'Отложена', category: 'backlog', isDefault: false },
      { key: '7', name: 'Отказ', category: 'cancelled', isDefault: false },
    ];

    let firstStateId: string | null = null;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i]!;
      const created = await services.prisma.issueState.create({
        data: {
          tenantId,
          projectId,
          name: d.name,
          color: categoryColor(d.category),
          category: d.category,
          sequence: i + 1,
          isDefault: d.isDefault,
        },
        select: { id: true },
      });
      stateByKey.set(d.key, created.id);
      if (d.isDefault) firstStateId = created.id;
    }
    if (firstStateId) {
      await services.prisma.project
        .update({
          where: { id: projectId },
          data: { defaultStateId: firstStateId },
        })
        .catch(() => undefined);
    }
    return stateByKey;
  }

  /**
   * Скачивает attachment из Битрикс24 Диск через disk.file.get → DOWNLOAD_URL
   * и кладёт в S3. На любой fail (network / non-2xx / size limit) — false.
   */
  private async downloadAttachment(args: {
    fileId: string;
    issueId: string;
    uploaderId: string;
    client: Bitrix24Client;
    services: ImportStrategyArgs['services'];
  }): Promise<boolean> {
    const { fileId, issueId, uploaderId, client, services } = args;

    let file: BitrixDiskFile | null;
    try {
      file = await client.getDiskFile(fileId);
    } catch (err) {
      this.logger.warn(
        {
          fileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'bitrix24-import: disk.file.get failed — skip attachment',
      );
      return false;
    }
    if (!file) return false;

    const downloadUrl = file.DOWNLOAD_URL ?? file.downloadUrl ?? null;
    if (!downloadUrl) return false;

    let buffer: Buffer;
    let mimeType = 'application/octet-stream';
    try {
      const downloaded = await client.downloadByUrl(downloadUrl);
      if (!downloaded) return false;
      if (downloaded.size === 0) return false;
      if (downloaded.size > Bitrix24ImportStrategy.MAX_ATTACHMENT_BYTES) {
        this.logger.warn(
          { fileId, size: downloaded.size },
          'bitrix24-import: attachment слишком большой — skip',
        );
        return false;
      }
      buffer = downloaded.buffer;
      if (downloaded.contentType) mimeType = downloaded.contentType;
    } catch (err) {
      this.logger.warn(
        {
          fileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'bitrix24-import: fetch attachment failed — skip',
      );
      return false;
    }

    const rawName =
      (file.NAME ?? file.name ?? `attachment-${nanoid(6)}`).toString();
    const fileName = rawName.slice(0, 250);
    const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const objectKey = `issues/${issueId}/attachments/${nanoid()}-${safeName}`;

    try {
      await services.s3.putObject({
        key: objectKey,
        body: buffer,
        contentType: mimeType,
      });
    } catch (err) {
      this.logger.warn(
        {
          fileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'bitrix24-import: S3 putObject failed — skip',
      );
      return false;
    }

    await services.prisma.issueAttachment.create({
      data: {
        issueId,
        uploaderId,
        fileName,
        fileUrl: objectKey,
        fileSize: buffer.byteLength,
        mimeType,
      },
    });
    return true;
  }

  /**
   * Если у task есть PARENT_ID и parent тоже импортирован в этой сессии —
   * выставляем Issue.parentId. Иначе skip.
   */
  private async linkParent(args: {
    task: BitrixTask;
    ourIssueId: string;
    issueIdByBitrixId: Map<string, string>;
    services: ImportStrategyArgs['services'];
  }): Promise<void> {
    const { task, ourIssueId, issueIdByBitrixId, services } = args;
    const parentBitrixId =
      task.PARENT_ID != null && String(task.PARENT_ID) !== '0'
        ? String(task.PARENT_ID)
        : null;
    if (!parentBitrixId) return;
    const parentOurId = issueIdByBitrixId.get(parentBitrixId);
    if (!parentOurId) return;
    await services.prisma.issue
      .update({
        where: { id: ourIssueId },
        data: { parentId: parentOurId },
      })
      .catch(() => undefined);
  }

  /**
   * DEPENDS_ON — массив task ID, от которых зависит текущая задача (т.е.
   * текущая «blocked_by» теми). Создаёт IssueRelation, только если обе
   * стороны импортированы в этой сессии.
   */
  private async linkDepends(args: {
    task: BitrixTask;
    ourIssueId: string;
    issueIdByBitrixId: Map<string, string>;
    userId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<void> {
    const { task, ourIssueId, issueIdByBitrixId, userId, services } = args;
    const depends = Array.isArray(task.DEPENDS_ON) ? task.DEPENDS_ON : [];
    for (const dep of depends) {
      const depId = String(dep ?? '').trim();
      if (!depId || depId === '0') continue;
      const targetOurId = issueIdByBitrixId.get(depId);
      if (!targetOurId) continue;
      try {
        await services.prisma.issueRelation.create({
          data: {
            sourceIssueId: ourIssueId,
            targetIssueId: targetOurId,
            relationType: 'blocked_by',
            createdById: userId,
          },
        });
      } catch (err) {
        // P2002 — уже есть relation, идемпотентно ОК.
        if (
          !(
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          )
        ) {
          throw err;
        }
      }
    }
  }

  /**
   * Identity-обёртка для cap'а. Реальный лимит 100 enforce'им в `trimErrors`,
   * вызываемом в конце `run`.
   */
  private cap(
    _errors: ImportErrorEntry[],
    entry: ImportErrorEntry,
  ): ImportErrorEntry {
    return entry;
  }

  /**
   * Trim errors до 100 (последняя превращается в truncated-маркер если
   * было >100).
   */
  private trimErrors(errors: ImportErrorEntry[]): void {
    if (errors.length <= 100) return;
    const dropped = errors.length - 99;
    errors.length = 100;
    errors[99] = {
      stage: 'truncated',
      message: `Превышен лимит 100 ошибок; пропущено ещё ${dropped}`,
      timestamp: new Date().toISOString(),
    };
  }
}

// ───────────────────────── Bitrix24 HTTP client ───────────────────────────

interface Bitrix24ClientOptions {
  webhookUrl: string;
  logger: Logger;
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Внутренний клиент для входящего вебхука Битрикс24.
 *
 * Каждый метод REST вызывается как `POST ${base}{method}.json` с JSON-body.
 * Битрикс24 принимает и form-data, и JSON; мы используем JSON для простоты
 * сериализации nested params (FILTER, ORDER, SELECT).
 *
 * Все list-эндпоинты возвращают `{ result, next?, total }`. Постранично
 * листаем через `start: N`.
 */
class Bitrix24Client {
  private readonly base: string;

  constructor(private readonly opts: Bitrix24ClientOptions) {
    // Нормализуем base: гарантируем trailing slash.
    this.base = opts.webhookUrl.replace(/\/+$/, '') + '/';
  }

  async getGroup(groupId: string): Promise<BitrixGroup> {
    // sonet_group.get принимает FILTER. Запрашиваем по ID.
    const resp = await this.call<{ result: BitrixGroup[] | BitrixGroup }>(
      'sonet_group.get',
      { FILTER: { ID: groupId } },
    );
    if (Array.isArray(resp.result)) {
      const first = resp.result[0];
      if (!first) {
        throw new Error(`Битрикс24: рабочая группа ID=${groupId} не найдена`);
      }
      return first;
    }
    return resp.result;
  }

  /**
   * Постранично возвращает задачи группы. tasks.task.list даёт пагинацию
   * через `start: N`; вернёт `next` (если есть ещё), `total`.
   */
  async listTasksByGroup(groupId: string): Promise<BitrixTask[]> {
    const all: BitrixTask[] = [];
    let start = 0;
    const MAX_PAGES = 1_000;
    for (let page = 0; page < MAX_PAGES; page++) {
      const resp = await this.call<{
        result: { tasks?: BitrixTask[] } | BitrixTask[];
        next?: number;
        total?: number;
      }>('tasks.task.list', {
        filter: { GROUP_ID: groupId },
        select: ['*'],
        start,
      });
      const items = Array.isArray(resp.result)
        ? resp.result
        : Array.isArray(resp.result?.tasks)
          ? resp.result.tasks
          : [];
      if (items.length === 0) break;
      all.push(...items);
      if (typeof resp.next === 'number' && resp.next > start) {
        start = resp.next;
        continue;
      }
      break;
    }
    return all;
  }

  async getTaskComments(taskId: string): Promise<BitrixComment[]> {
    try {
      const resp = await this.call<{ result: BitrixComment[] }>(
        'task.commentitem.getlist',
        { taskId, ORDER: { POST_DATE: 'asc' }, FILTER: {} },
      );
      return Array.isArray(resp.result) ? resp.result : [];
    } catch (err) {
      if (
        err instanceof BitrixApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        return [];
      }
      throw err;
    }
  }

  async getUser(bitrixUserId: string): Promise<BitrixUser | null> {
    try {
      const resp = await this.call<{ result: BitrixUser[] }>('user.get', {
        ID: bitrixUserId,
      });
      const list = Array.isArray(resp.result) ? resp.result : [];
      return list[0] ?? null;
    } catch (err) {
      if (
        err instanceof BitrixApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        return null;
      }
      throw err;
    }
  }

  async getDiskFile(fileId: string): Promise<BitrixDiskFile | null> {
    try {
      const resp = await this.call<{ result: BitrixDiskFile }>('disk.file.get', {
        id: fileId,
      });
      return resp.result ?? null;
    } catch (err) {
      if (
        err instanceof BitrixApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Скачивает attachment по абсолютному URL (DOWNLOAD_URL из disk.file.get).
   * Возвращает null при non-2xx.
   */
  async downloadByUrl(
    url: string,
  ): Promise<{ buffer: Buffer; size: number; contentType?: string } | null> {
    const absoluteUrl = url.startsWith('http')
      ? url
      : new URL(url, this.base).toString();
    const res = await this.requestRaw(absoluteUrl, { method: 'GET' }, { absolute: true });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? undefined;
    return {
      buffer: buf,
      size: buf.byteLength,
      contentType: ct?.split(';')[0]?.trim(),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * REST-вызов метода Битрикс24. Бросает BitrixApiError на ошибки HTTP.
   *
   * Битрикс24 возвращает 200 даже на ошибки приложения, с `error` в body.
   * Мы превращаем такое в BitrixApiError со status маппингом:
   *   - 'INVALID_TOKEN' / 'NO_AUTH_FOUND' / 'WRONG_CLIENT' → 401.
   *   - 'INSUFFICIENT_SCOPE' / 'ACCESS_DENIED' → 403.
   *   - 'QUERY_LIMIT_EXCEEDED' → 429.
   *   - всё иное → 500 (фатально для текущего вызова, но не для импорта в целом).
   */
  private async call<T>(method: string, body: unknown): Promise<T> {
    const url = `${this.base}${method}.json`;
    const res = await this.requestRaw(url, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BitrixApiError(
        `Bitrix24 API ${res.status} ${res.statusText} on ${method}: ${text.slice(0, 500)}`,
        res.status,
      );
    }

    const data = (await res.json().catch(() => null)) as
      | { error?: string; error_description?: string }
      | null;
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      const mappedStatus = mapBitrixErrorToStatus(data.error);
      throw new BitrixApiError(
        `Bitrix24 API error: ${data.error} (${data.error_description ?? ''})`,
        mappedStatus,
      );
    }
    return data as T;
  }

  /**
   * HTTP-запрос с retry на 429/5xx (exponential backoff 1s/2s/4s/...).
   * `opts.absolute=true` — `url` уже полный.
   */
  private async requestRaw(
    url: string,
    init?: RequestInit,
    opts: { absolute?: boolean } = {},
  ): Promise<Response> {
    void opts;

    const maxAttempts = Bitrix24ImportStrategy['MAX_RETRY_ATTEMPTS'];
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        Bitrix24ImportStrategy['REQUEST_TIMEOUT_MS'],
      );
      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          redirect: 'follow',
        });
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }
      clearTimeout(timeoutId);

      if (res.ok) return res;

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '0');
        const waitMs = retryAfter > 0 ? retryAfter * 1_000 : backoffMs(attempt);
        if (attempt < maxAttempts) {
          this.opts.logger.warn(
            { url, status: res.status, attempt, waitMs },
            'bitrix24: HTTP ' + res.status + ' — backoff retry',
          );
          await sleep(waitMs);
          continue;
        }
      }

      return res;
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'bitrix24: unknown fetch error'));
  }
}

class BitrixApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BitrixApiError';
  }
}

// ───────────────────────── pure helpers ───────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function makeIdentifier(name: string): string {
  const ascii = name
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '');
  const words = ascii.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) return `B${Math.floor(Math.random() * 9000 + 1000)}`;
  if (words.length >= 2) {
    return words.slice(0, 5).map((w) => w[0]!).join('').slice(0, 5);
  }
  const single = words[0]!;
  return single.slice(0, 5).padEnd(3, 'X');
}

function safeParseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Битрикс24 PRIORITY: 0=Низкий, 1=Средний, 2=Высокий → наш Issue.priority.
 * Битрикс24 не имеет separate "blocker" — высокий это максимум.
 */
function mapPriority(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'none';
  if (n >= 2) return 'urgent';
  if (n === 1) return 'medium';
  if (n === 0) return 'low';
  return 'none';
}

function categoryColor(category: string): string {
  switch (category) {
    case 'completed':
      return '#10B981';
    case 'started':
      return '#3B82F6';
    case 'cancelled':
      return '#EF4444';
    case 'backlog':
      return '#64748B';
    default:
      return '#94A3B8';
  }
}

function sanitizeDescription(s: unknown): string | null {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  return str.slice(0, 100_000);
}

/**
 * Битрикс24 в tasks.task.list возвращает поле `UF_TASK_WEBDAV_FILES` —
 * массив file id'ов на Битрикс24 Диске. Иногда это `ufTaskWebdavFiles` (camel)
 * или `attachedFiles` (legacy). Собираем всё в один список строк.
 */
function collectAttachmentFileIds(task: BitrixTask): string[] {
  const candidates: Array<string | number | undefined> = [];
  const sources = [
    task.UF_TASK_WEBDAV_FILES,
    task.ufTaskWebdavFiles,
    task.attachedFiles,
  ];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const item of src) {
        if (item != null) candidates.push(item as string | number);
      }
    }
  }
  return candidates
    .map((c) => String(c).trim())
    .filter((c) => c.length > 0 && c !== '0');
}

/**
 * Маппинг Битрикс24 application-error code → HTTP-like статус для нашей
 * retry/finalize-failed логики.
 */
function mapBitrixErrorToStatus(errorCode: string): number {
  const code = errorCode.toUpperCase();
  if (
    code === 'INVALID_TOKEN' ||
    code === 'NO_AUTH_FOUND' ||
    code === 'WRONG_CLIENT' ||
    code === 'INVALID_CREDENTIALS'
  ) {
    return 401;
  }
  if (
    code === 'INSUFFICIENT_SCOPE' ||
    code === 'ACCESS_DENIED' ||
    code === 'NO_AUTH'
  ) {
    return 403;
  }
  if (code === 'QUERY_LIMIT_EXCEEDED' || code === 'OPERATION_TIME_LIMIT') {
    return 429;
  }
  return 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, max 16s.
  const base = 1_000 * Math.pow(2, attempt - 1);
  return Math.min(base, 16_000);
}

// ───────────────────────── Bitrix24 types (минимум) ───────────────────────

interface BitrixGroup {
  ID?: string;
  NAME?: string;
  DESCRIPTION?: string | null;
}

/**
 * tasks.task.list возвращает task в UPPER_SNAKE_CASE. Поля выбраны под
 * наш маппинг; всё остальное (PROJECT_ID, START_DATE_PLAN и т.п.) игнорим.
 *
 * Иногда Битрикс24 (особенно ufTaskWebdavFiles) присылает camelCase — учитываем
 * оба варианта.
 */
interface BitrixTask {
  ID?: string | number;
  TITLE?: string;
  DESCRIPTION?: string | null;
  STATUS?: string | number;
  RESPONSIBLE_ID?: string | number;
  CREATED_BY?: string | number;
  DEADLINE?: string | null;
  PRIORITY?: string | number;
  PARENT_ID?: string | number | null;
  GROUP_ID?: string | number;
  DEPENDS_ON?: Array<string | number>;
  UF_TASK_WEBDAV_FILES?: Array<string | number>;
  ufTaskWebdavFiles?: Array<string | number>;
  attachedFiles?: Array<string | number>;
}

interface BitrixComment {
  ID?: string | number;
  AUTHOR_ID?: string | number;
  POST_MESSAGE?: string;
  POST_DATE?: string;
}

interface BitrixUser {
  ID?: string | number;
  EMAIL?: string | null;
  NAME?: string;
  LAST_NAME?: string;
}

interface BitrixDiskFile {
  ID?: string;
  NAME?: string;
  DOWNLOAD_URL?: string;
  // некоторые ответы (rest) приходят в camelCase
  id?: string;
  name?: string;
  downloadUrl?: string;
}
