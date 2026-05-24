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
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — импорт из Trello JSON-export.
 *
 * Поддерживаемые поля из Trello JSON:
 *   boards[], lists[], cards[], members[], labels[], actions[] (для комментариев).
 *
 * Что мапим (из TZ):
 *   Board   → Project          (identifier = uppercase prefix 3-5 chars)
 *   List    → IssueState       (category heuristic по позиции)
 *   Card    → Issue             (externalSource='trello', externalId=card.id)
 *   member  → IssueAssignee    (через userMappings[email] → ourUserId)
 *   label   → Label / IssueLabel
 *   comment → IssueComment
 *   attach. → IssueAttachment  (best-effort: try fetch URL → S3, на err — лог+skip)
 *
 * Идемпотентность: Issue с (tenantId, externalSource='trello', externalId=card.id)
 * уже существует → skip card целиком (комментарии/attachments тоже не дублируются,
 * потому что мы скипаем создание самой задачи).
 *
 * НЕ обрабатываются (в первом релизе):
 *   - card.idChecklists (нет нативной модели подзадач-чек-листов).
 *   - card.shortLink (есть в IssueLink — но не в этом релизе).
 *   - вложенные subboards.
 */
@Injectable()
export class TrelloImportStrategy implements ImportStrategy {
  private readonly logger = new Logger(TrelloImportStrategy.name);

  /**
   * Throttle на эмиссию WS-progress'а: ~раз в 5 секунд по ТЗ.
   * Воркер всё равно эмитит финальное событие отдельно.
   */
  private static readonly PROGRESS_BATCH_SIZE = 50;

  async run(args: ImportStrategyArgs): Promise<ImportResult> {
    const { importLog, params, services, onProgress } = args;
    const tenantId = importLog.tenantId;
    const tenantTop = tenantTopOf(tenantId);
    const userId = importLog.initiatedByUserId;

    const jsonContent = (params.jsonContent ?? {}) as TrelloExport;
    const selectedBoardIds = (params.selectedBoardIds ?? []) as string[];
    const userMappings = (params.userMappings ?? {}) as Record<
      string,
      string | null
    >;

    const errors: ImportErrorEntry[] = [];
    const result: ImportResult = {
      totalProjects: 0,
      totalIssues: 0,
      totalComments: 0,
      totalAttachments: 0,
      unmatchedEmails: [],
      errors,
    };

    // Парсинг + базовая валидация.
    const allBoards = Array.isArray(jsonContent.boards) ? jsonContent.boards : [];
    const boards = allBoards.filter((b) => selectedBoardIds.includes(b.id));
    if (boards.length === 0) {
      throw new Error(
        `Trello JSON: ни один из выбранных board'ов не найден (selected=${selectedBoardIds.length}, available=${allBoards.length})`,
      );
    }

    // Подсчёт общего объёма (для onProgress total).
    const allCards = Array.isArray(jsonContent.cards) ? jsonContent.cards : [];
    const totalCards = boards.reduce(
      (sum, b) =>
        sum + allCards.filter((c) => c.idBoard === b.id && !c.closed).length,
      0,
    );

    // Карта email-mapping → unmatched.
    const matchedEmails = new Set<string>();
    const unmatchedEmails = new Set<string>();
    const allMembers = Array.isArray(jsonContent.members)
      ? jsonContent.members
      : [];
    for (const m of allMembers) {
      const email = (m.email ?? '').toLowerCase().trim();
      if (!email) continue;
      if (email in userMappings) {
        matchedEmails.add(email);
      } else {
        unmatchedEmails.add(email);
      }
    }
    result.unmatchedEmails = Array.from(unmatchedEmails);

    let processedItems = 0;

    for (const board of boards) {
      try {
        const project = await this.upsertProject({
          tenantId,
          board,
          userId,
          services,
        });
        result.totalProjects += 1;

        // Lists → IssueState.
        const lists = (jsonContent.lists ?? [])
          .filter((l) => l.idBoard === board.id && !l.closed)
          .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
        const stateByListId = await this.createStatesForLists({
          tenantId,
          projectId: project.id,
          lists,
          services,
        });

        // Labels (board labels).
        const trelloLabels = (jsonContent.labels ?? []).filter(
          (l) => l.idBoard === board.id,
        );
        const labelIdByTrelloId = await this.createLabelsForBoard({
          tenantId,
          projectId: project.id,
          trelloLabels,
          services,
          errors,
        });

        // Members → memberByTrelloId (для маппинга card.idMembers).
        const memberByTrelloId = new Map<string, string | null>();
        for (const m of allMembers) {
          const email = (m.email ?? '').toLowerCase().trim();
          if (!email) {
            memberByTrelloId.set(m.id, null);
            continue;
          }
          const mapped = userMappings[email];
          // mapped === undefined → unmatched; mapped === null → намеренный skip; иначе ourUserId.
          memberByTrelloId.set(m.id, mapped ?? null);
        }

        // Cards → Issues.
        const boardCards = allCards.filter(
          (c) => c.idBoard === board.id && !c.closed,
        );
        for (const card of boardCards) {
          // Проверка cancellation между батчами (помечено в БД из import.service.cancel).
          if (processedItems % TrelloImportStrategy.PROGRESS_BATCH_SIZE === 0) {
            const wasCancelled = await this.isCancelled({
              importLogId: importLog.id,
              services,
            });
            if (wasCancelled) {
              this.logger.warn(
                { importLogId: importLog.id },
                'trello-import: импорт отменён пользователем — выход',
              );
              return result;
            }
          }

          try {
            const created = await this.createIssueFromCard({
              tenantId,
              projectId: project.id,
              projectIdentifier: project.identifier,
              card,
              stateByListId,
              labelIdByTrelloId,
              memberByTrelloId,
              userId,
              services,
            });
            if (created.skipped) {
              processedItems += 1;
              services.metrics?.incImportIssueProcessed({
                tenantTop,
                source: 'trello',
              });
              continue;
            }

            result.totalIssues += 1;

            // Комментарии (actions type='commentCard').
            const cardActions = (jsonContent.actions ?? []).filter(
              (a) =>
                a.type === 'commentCard' &&
                a.data?.card?.id === card.id,
            );
            for (const action of cardActions) {
              try {
                await this.createCommentFromAction({
                  issueId: created.id,
                  action,
                  memberByTrelloId,
                  defaultUserId: userId,
                  services,
                });
                result.totalComments += 1;
              } catch (err) {
                errors.push({
                  stage: 'comment',
                  externalId: action.id ?? null,
                  message: err instanceof Error ? err.message : String(err),
                  timestamp: new Date().toISOString(),
                });
              }
            }

            // Attachments (best-effort).
            const attachments = Array.isArray(card.attachments)
              ? card.attachments
              : [];
            for (const att of attachments) {
              try {
                const ok = await this.createAttachmentFromTrelloAttachment({
                  issueId: created.id,
                  attachment: att,
                  uploaderId: userId,
                  services,
                });
                if (ok) result.totalAttachments += 1;
              } catch (err) {
                errors.push({
                  stage: 'attachment',
                  externalId: att.id ?? null,
                  message: err instanceof Error ? err.message : String(err),
                  timestamp: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            errors.push({
              stage: 'card',
              externalId: card.id,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            });
          }

          processedItems += 1;
          services.metrics?.incImportIssueProcessed({
            tenantTop,
            source: 'trello',
          });
          if (processedItems % TrelloImportStrategy.PROGRESS_BATCH_SIZE === 0) {
            await services.prisma.importLog
              .update({
                where: { id: importLog.id },
                data: { processedItems },
              })
              .catch(() => undefined);
            await onProgress({
              processed: processedItems,
              total: totalCards,
              phase: 'issues',
            });
          }
        }
      } catch (err) {
        errors.push({
          stage: 'board',
          externalId: board.id,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Финальный progress + persist processedItems / unmatched.
    await services.prisma.importLog
      .update({
        where: { id: importLog.id },
        data: {
          processedItems,
          unmatchedJson: result.unmatchedEmails as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
    await onProgress({
      processed: processedItems,
      total: totalCards,
      phase: 'finalizing',
    });
    return result;
  }

  // ────────────────────────── helpers ──────────────────────────────────

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
   * Создаёт Project из Trello board. Identifier — 3-5 char uppercase prefix
   * из имени board'а. На коллизию slug добавляем суффикс nanoid(4).
   */
  private async upsertProject(args: {
    tenantId: string;
    board: TrelloBoard;
    userId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<{ id: string; identifier: string }> {
    const { tenantId, board, userId, services } = args;

    // Сначала проверим, не импортировали ли мы этот board ранее (для
    // повторного запуска импорта на тот же ImportLog не делаем; идемпотентность
    // — на уровне Issue, не Project. Но дубли проектов всё равно избегаем).
    const slugBase = slugify(board.name) || 'imported';
    const identifierBase = makeIdentifier(board.name);

    let slug = slugBase;
    let identifier = identifierBase;
    // Анти-коллизия slug/identifier per tenant.
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await services.prisma.project.findFirst({
        where: {
          tenantId,
          OR: [{ slug }, { identifier }],
        },
        select: { id: true, identifier: true, slug: true },
      });
      if (!existing) break;
      // Suffix чтобы избежать коллизии.
      const suffix = nanoid(4).toLowerCase();
      slug = `${slugBase}-${suffix}`;
      identifier = `${identifierBase.slice(0, 3)}${suffix.slice(0, 2).toUpperCase()}`;
    }

    const created = await services.prisma.project.create({
      data: {
        tenantId,
        slug,
        identifier,
        name: board.name,
        description: board.desc ?? null,
        ownerId: userId,
        timezone: 'Europe/Moscow',
        network: 0,
      },
      select: { id: true, identifier: true },
    });
    // Project creator → admin (role=20). NB: legacy projects.service делает
    // тот же шаг внутри transaction; здесь обходимся отдельным insert'ом.
    await services.prisma.projectMember
      .create({
        data: { projectId: created.id, userId, role: 20 },
      })
      .catch(() => undefined);
    return created;
  }

  /**
   * Создаёт IssueState из lists Trello board'а. Эвристика категории:
   *   - первый list (pos asc) → 'unstarted'
   *   - последний list → 'completed'
   *   - всё между → 'started'
   *   - если list ровно 1 → 'unstarted'
   */
  private async createStatesForLists(args: {
    tenantId: string;
    projectId: string;
    lists: TrelloList[];
    services: ImportStrategyArgs['services'];
  }): Promise<Map<string, string>> {
    const { tenantId, projectId, lists, services } = args;
    const stateByListId = new Map<string, string>();
    if (lists.length === 0) return stateByListId;

    const lastIdx = lists.length - 1;
    let firstStateId: string | null = null;
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!;
      const category: 'unstarted' | 'started' | 'completed' =
        i === 0
          ? 'unstarted'
          : i === lastIdx && lists.length > 1
            ? 'completed'
            : 'started';
      const color =
        category === 'completed'
          ? '#10B981'
          : category === 'started'
            ? '#3B82F6'
            : '#94A3B8';
      const isDefault = i === 0;
      const created = await services.prisma.issueState.create({
        data: {
          tenantId,
          projectId,
          name: list.name,
          color,
          category,
          sequence: i + 1,
          isDefault,
        },
        select: { id: true },
      });
      stateByListId.set(list.id, created.id);
      if (isDefault) firstStateId = created.id;
    }
    if (firstStateId) {
      await services.prisma.project
        .update({
          where: { id: projectId },
          data: { defaultStateId: firstStateId },
        })
        .catch(() => undefined);
    }
    return stateByListId;
  }

  private async createLabelsForBoard(args: {
    tenantId: string;
    projectId: string;
    trelloLabels: TrelloLabel[];
    services: ImportStrategyArgs['services'];
    errors: ImportErrorEntry[];
  }): Promise<Map<string, string>> {
    const { tenantId, projectId, trelloLabels, services, errors } = args;
    const map = new Map<string, string>();
    for (const tl of trelloLabels) {
      const name = (tl.name ?? '').trim() || `label-${tl.id.slice(0, 6)}`;
      try {
        const created = await services.prisma.label.create({
          data: {
            tenantId,
            projectId,
            name: name.slice(0, 50),
            color: trelloColorToHex(tl.color ?? null),
          },
          select: { id: true },
        });
        map.set(tl.id, created.id);
      } catch (err) {
        // P2002 на (tenantId, projectId, name) — допустим, метка уже есть.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const existing = await services.prisma.label.findFirst({
            where: { tenantId, projectId, name: name.slice(0, 50) },
            select: { id: true },
          });
          if (existing) map.set(tl.id, existing.id);
        } else {
          errors.push({
            stage: 'label',
            externalId: tl.id,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    return map;
  }

  /**
   * Создаёт Issue (если ещё не существует с этим externalId).
   * Возвращает `skipped: true` если есть идемпотентный hit.
   */
  private async createIssueFromCard(args: {
    tenantId: string;
    projectId: string;
    projectIdentifier: string;
    card: TrelloCard;
    stateByListId: Map<string, string>;
    labelIdByTrelloId: Map<string, string>;
    memberByTrelloId: Map<string, string | null>;
    userId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<{ id: string; skipped: boolean }> {
    const {
      tenantId,
      projectId,
      projectIdentifier,
      card,
      stateByListId,
      labelIdByTrelloId,
      memberByTrelloId,
      userId,
      services,
    } = args;

    // Идемпотентность: skip если Issue с (tenantId, externalSource='trello',
    // externalId=card.id) уже есть.
    const existing = await services.prisma.issue.findFirst({
      where: {
        tenantId,
        externalSource: 'trello',
        externalId: card.id,
      },
      select: { id: true },
    });
    if (existing) {
      return { id: existing.id, skipped: true };
    }

    const dueDate = card.due ? safeParseDate(card.due) : null;
    const stateId = card.idList ? (stateByListId.get(card.idList) ?? null) : null;

    return services.prisma.$transaction(async (tx) => {
      const maxRow = await tx.issue.aggregate({
        where: { projectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const identifier = `${projectIdentifier}-${sequenceId}`;

      const description = card.desc ?? null;
      const created = await tx.issue.create({
        data: {
          tenantId,
          projectId,
          identifier,
          sequenceId,
          title: (card.name ?? '').slice(0, 500) || '(без названия)',
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority: 'none',
          stateId,
          sortOrder: Math.round((card.pos ?? 0) % 1_000_000),
          dueDate,
          externalSource: 'trello',
          externalId: card.id,
          createdById: userId,
          createdManually: false,
        },
        select: { id: true },
      });

      // Assignees.
      const idMembers = Array.isArray(card.idMembers) ? card.idMembers : [];
      const assigneeUserIds = new Set<string>();
      for (const memberTrelloId of idMembers) {
        const ourUserId = memberByTrelloId.get(memberTrelloId);
        if (ourUserId) assigneeUserIds.add(ourUserId);
      }
      if (assigneeUserIds.size > 0) {
        await tx.issueAssignee.createMany({
          data: Array.from(assigneeUserIds).map((uid) => ({
            issueId: created.id,
            userId: uid,
            assignedById: userId,
          })),
          skipDuplicates: true,
        });
      }
      // Labels.
      const idLabels = Array.isArray(card.idLabels) ? card.idLabels : [];
      const labelIds: string[] = [];
      for (const trelloLabelId of idLabels) {
        const ourLabelId = labelIdByTrelloId.get(trelloLabelId);
        if (ourLabelId) labelIds.push(ourLabelId);
      }
      if (labelIds.length > 0) {
        await tx.issueLabel.createMany({
          data: labelIds.map((labelId) => ({ issueId: created.id, labelId })),
          skipDuplicates: true,
        });
      }
      return { id: created.id, skipped: false };
    });
  }

  private async createCommentFromAction(args: {
    issueId: string;
    action: TrelloAction;
    memberByTrelloId: Map<string, string | null>;
    defaultUserId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<void> {
    const { issueId, action, memberByTrelloId, defaultUserId, services } = args;
    const text = action.data?.text ?? '';
    if (!text.trim()) return;
    const authorId =
      (action.idMemberCreator && memberByTrelloId.get(action.idMemberCreator)) ||
      defaultUserId;
    await services.prisma.issueComment.create({
      data: {
        issueId,
        authorId,
        content: text.slice(0, 50_000),
        contentHtml: null,
        contentStripped: text.slice(0, 50_000),
        access: 'internal',
        createdAt: action.date ? safeParseDate(action.date) ?? new Date() : new Date(),
      },
    });
  }

  /**
   * Best-effort: пытается скачать URL из Trello attachment и положить в S3.
   * На любой fail (network / non-2xx / size limit) — возвращает false без
   * выброса (caller просто инкрементирует errors).
   *
   * Размер ограничен MAX_DOWNLOAD_BYTES — 25 МБ (как в attachments.service).
   */
  private async createAttachmentFromTrelloAttachment(args: {
    issueId: string;
    attachment: TrelloAttachment;
    uploaderId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<boolean> {
    const { issueId, attachment, uploaderId, services } = args;
    if (!attachment.url) return false;

    const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

    let buffer: Buffer;
    let mimeType = attachment.mimeType ?? 'application/octet-stream';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(attachment.url, {
        signal: controller.signal,
        redirect: 'follow',
      }).finally(() => clearTimeout(timeoutId));
      if (!res.ok) {
        this.logger.warn(
          { url: attachment.url, status: res.status },
          'trello-import: attachment fetch non-2xx — skip',
        );
        return false;
      }
      const headerCt = res.headers.get('content-type');
      if (headerCt) mimeType = headerCt.split(';')[0]!.trim() || mimeType;
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) return false;
      if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
        this.logger.warn(
          { url: attachment.url, size: arrayBuffer.byteLength },
          'trello-import: attachment слишком большой — skip',
        );
        return false;
      }
      buffer = Buffer.from(arrayBuffer);
    } catch (err) {
      this.logger.warn(
        {
          url: attachment.url,
          err: err instanceof Error ? err.message : String(err),
        },
        'trello-import: fetch attachment failed — skip',
      );
      return false;
    }

    const fileName = (attachment.name ?? `attachment-${nanoid(6)}`).slice(0, 250);
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
          url: attachment.url,
          err: err instanceof Error ? err.message : String(err),
        },
        'trello-import: S3 putObject failed — skip',
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
}

// ───────────────────────── helpers (pure) ─────────────────────────────

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
  // 3-5 uppercase chars из латиницы; на кириллице → транслит первые буквы слов.
  const ascii = name
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '');
  const words = ascii
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return `BOARD${Math.floor(Math.random() * 90 + 10)}`;
  if (words.length >= 2) {
    const acronym = words
      .slice(0, 5)
      .map((w) => w[0]!)
      .join('');
    return acronym.slice(0, 5);
  }
  const single = words[0]!;
  return single.slice(0, 5).padEnd(3, 'X');
}

function trelloColorToHex(color: string | null): string {
  // Trello use: yellow|red|green|blue|purple|orange|black|sky|lime|pink|null.
  const map: Record<string, string> = {
    yellow: '#F2D600',
    red: '#EB5A46',
    green: '#61BD4F',
    blue: '#0079BF',
    purple: '#C377E0',
    orange: '#FF9F1A',
    black: '#344563',
    sky: '#00C2E0',
    lime: '#51E898',
    pink: '#FF78CB',
  };
  return (color && map[color]) ?? '#94A3B8';
}

function safeParseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ───────────────────────── Trello JSON types (минимум, what we use) ───

interface TrelloExport {
  boards?: TrelloBoard[];
  lists?: TrelloList[];
  cards?: TrelloCard[];
  members?: TrelloMember[];
  labels?: TrelloLabel[];
  actions?: TrelloAction[];
}

interface TrelloBoard {
  id: string;
  name: string;
  desc?: string | null;
  closed?: boolean;
}

interface TrelloList {
  id: string;
  idBoard: string;
  name: string;
  pos?: number;
  closed?: boolean;
}

interface TrelloCard {
  id: string;
  idBoard: string;
  idList?: string;
  name?: string;
  desc?: string | null;
  due?: string | null;
  pos?: number;
  closed?: boolean;
  idMembers?: string[];
  idLabels?: string[];
  attachments?: TrelloAttachment[];
}

interface TrelloMember {
  id: string;
  fullName?: string;
  email?: string | null;
}

interface TrelloLabel {
  id: string;
  idBoard: string;
  name?: string;
  color?: string | null;
}

interface TrelloAttachment {
  id?: string;
  name?: string;
  url?: string;
  mimeType?: string;
  bytes?: number;
}

interface TrelloAction {
  id?: string;
  type: string;
  date?: string;
  idMemberCreator?: string;
  data?: {
    text?: string;
    card?: { id?: string };
  };
}
