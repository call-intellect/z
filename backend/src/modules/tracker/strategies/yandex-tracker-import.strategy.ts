import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { ImportErrorEntry } from '../dto/imports/import-log-response.dto';

import type { ImportResult, ImportStrategy, ImportStrategyArgs } from './import-strategy.interface';

@Injectable()
export class YandexTrackerImportStrategy implements ImportStrategy {
  private readonly logger = new Logger(YandexTrackerImportStrategy.name);

  private static readonly PROGRESS_BATCH_SIZE = 50;

  private static readonly MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

  private static readonly API_BASE = 'https://api.tracker.yandex.net/v2';

  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  private static readonly MAX_RETRY_ATTEMPTS = 4;

  private static readonly PAGE_SIZE = 50;

  async run(args: ImportStrategyArgs): Promise<ImportResult> {
    const { importLog, params, services, onProgress } = args;
    const tenantId = importLog.tenantId;
    const tenantTop = tenantTopOf(tenantId);
    const userId = importLog.initiatedByUserId;

    const oauthToken = String(params.oauthToken ?? '').trim();
    const selectedQueueIds = Array.isArray(params.selectedQueueIds)
      ? (params.selectedQueueIds as string[])
      : [];
    const userMappings = (params.userMappings ?? {}) as Record<string, string | null>;
    const orgId =
      typeof params.orgId === 'string' && params.orgId.trim() ? params.orgId.trim() : undefined;

    if (!oauthToken) {
      throw new Error('Yandex Tracker import: oauthToken не задан');
    }
    if (selectedQueueIds.length === 0) {
      throw new Error('Yandex Tracker import: selectedQueueIds пуст — нечего импортировать');
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

    const client = new YandexTrackerClient({
      oauthToken,
      orgId,
      logger: this.logger,
      fetchImpl: (input, init) => fetch(input as unknown as string, init as unknown as RequestInit),
    });

    const unmatchedEmails = new Set<string>();
    let processedItems = 0;

    type LoadedQueue = {
      queue: YandexQueue;
      issues: YandexIssue[];
    };
    const loaded: LoadedQueue[] = [];
    for (const queueId of selectedQueueIds) {
      try {
        const queue = await client.getQueue(queueId);
        const issues = await client.listIssuesByQueue(queueId);
        loaded.push({ queue, issues });
      } catch (err) {
        errors.push({
          stage: 'queue',
          externalId: queueId,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }

    const totalIssues = loaded.reduce((sum, q) => sum + q.issues.length, 0);

    const issueIdByYandexId = new Map<string, string>();
    const yandexIdByKey = new Map<string, string>();
    for (const { issues } of loaded) {
      for (const issue of issues) {
        if (issue.id && issue.key) yandexIdByKey.set(issue.key, issue.id);
      }
    }

    for (const { queue, issues } of loaded) {
      let project: { id: string; identifier: string };
      let stateByName: Map<string, string>;
      try {
        project = await this.upsertProject({
          tenantId,
          queue,
          userId,
          services,
        });
        result.totalProjects += 1;

        stateByName = await this.createStatesForQueue({
          tenantId,
          projectId: project.id,
          queue,
          services,
        });
      } catch (err) {
        errors.push({
          stage: 'queue',
          externalId: queue.id ?? queue.key ?? null,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const labelByName = new Map<string, string>();

      for (const issue of issues) {
        if (
          processedItems > 0 &&
          processedItems % YandexTrackerImportStrategy.PROGRESS_BATCH_SIZE === 0
        ) {
          const wasCancelled = await this.isCancelled({
            importLogId: importLog.id,
            services,
          });
          if (wasCancelled) {
            this.logger.warn(
              { importLogId: importLog.id },
              'yandex-tracker-import: импорт отменён пользователем — выход',
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
            total: totalIssues,
            phase: 'issues',
          });
        }

        try {
          const outcome = await this.importIssue({
            tenantId,
            project,
            issue,
            stateByName,
            labelByName,
            userMappings,
            unmatchedEmails,
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
            issueIdByYandexId.set(issue.id, outcome.ourIssueId);
          }
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'issue',
              externalId: issue.id ?? issue.key ?? null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }

        processedItems += 1;
        services.metrics?.incImportIssueProcessed({
          tenantTop,
          source: 'yandex_tracker',
        });
      }
    }

    for (const { issues } of loaded) {
      for (const issue of issues) {
        const ourId = issueIdByYandexId.get(issue.id);
        if (!ourId) continue;
        try {
          await this.linkParent({
            issue,
            ourIssueId: ourId,
            issueIdByYandexId,
            yandexIdByKey,
            services,
          });
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'parent',
              externalId: issue.id ?? null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
        try {
          const linksCount = await this.linkRelations({
            issue,
            tenantId,
            ourIssueId: ourId,
            issueIdByYandexId,
            yandexIdByKey,
            userId,
            client,
            services,
          });
          void linksCount;
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'links',
              externalId: issue.id ?? null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    }

    result.unmatchedEmails = Array.from(unmatchedEmails);
    this.trimErrors(errors);
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
      total: totalIssues,
      phase: 'finalizing',
    });
    return result;
  }

  private async importIssue(args: {
    tenantId: string;
    project: { id: string; identifier: string };
    issue: YandexIssue;
    stateByName: Map<string, string>;
    labelByName: Map<string, string>;
    userMappings: Record<string, string | null>;
    unmatchedEmails: Set<string>;
    userId: string;
    client: YandexTrackerClient;
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
      issue,
      stateByName,
      labelByName,
      userMappings,
      unmatchedEmails,
      userId,
      client,
      services,
      errors,
    } = args;

    const existing = await services.prisma.issue.findFirst({
      where: {
        tenantId,
        externalSource: 'yandex_tracker',
        externalId: issue.id,
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

    let assigneeUserId: string | null = null;
    const assigneeEmail = (issue.assignee?.email ?? '').toLowerCase().trim();
    if (assigneeEmail) {
      if (assigneeEmail in userMappings) {
        assigneeUserId = userMappings[assigneeEmail] ?? null;
      } else {
        unmatchedEmails.add(assigneeEmail);
      }
    }

    const stateName = (issue.status?.display ?? issue.status?.key ?? '').trim();
    const stateId = stateName ? (stateByName.get(stateName) ?? null) : null;

    const priority = mapPriority(issue.priority?.key);
    const dueDate = issue.deadline ? safeParseDate(issue.deadline) : null;
    const description = issue.description ?? null;

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
          title: (issue.summary ?? '').slice(0, 500) || '(без названия)',
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority,
          stateId,
          sortOrder: 0,
          dueDate,
          externalSource: 'yandex_tracker',
          externalId: issue.id,
          createdById: userId,
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

    const tags = Array.isArray(issue.tags) ? issue.tags : [];
    for (const tagRaw of tags) {
      const tag = (tagRaw ?? '').toString().trim();
      if (!tag) continue;
      try {
        const labelId = await this.ensureLabel({
          tenantId,
          projectId: project.id,
          name: tag,
          labelByName,
          services,
        });
        if (labelId) {
          await services.prisma.issueLabel
            .create({
              data: { issueId: created.id, labelId },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        errors.push(
          this.cap(errors, {
            stage: 'label',
            externalId: tag,
            message: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    let commentsCount = 0;
    try {
      const comments = await client.getIssueComments(issue.key ?? issue.id);
      for (const c of comments) {
        try {
          const authorEmail = (c.createdBy?.email ?? '').toLowerCase().trim();
          let authorId = userId;
          if (authorEmail && authorEmail in userMappings) {
            authorId = userMappings[authorEmail] ?? userId;
          } else if (authorEmail) {
            unmatchedEmails.add(authorEmail);
          }
          const text = (c.text ?? '').slice(0, 50_000);
          if (!text.trim()) continue;
          await services.prisma.issueComment.create({
            data: {
              issueId: created.id,
              authorId,
              content: text,
              contentHtml: null,
              contentStripped: text,
              access: 'internal',
              createdAt: c.createdAt ? (safeParseDate(c.createdAt) ?? new Date()) : new Date(),
            },
          });
          commentsCount += 1;
        } catch (err) {
          errors.push(
            this.cap(errors, {
              stage: 'comment',
              externalId: c.id ?? null,
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
          externalId: issue.id ?? null,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    let attachmentsCount = 0;
    try {
      const attachments = await client.getIssueAttachments(issue.key ?? issue.id);
      for (const att of attachments) {
        try {
          const ok = await this.downloadAttachment({
            attachment: att,
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
              externalId: att.id ?? null,
              message: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    } catch (err) {
      errors.push(
        this.cap(errors, {
          stage: 'attachments',
          externalId: issue.id ?? null,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return {
      created: true,
      ourIssueId: created.id,
      comments: commentsCount,
      attachments: attachmentsCount,
    };
  }

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

  private async upsertProject(args: {
    tenantId: string;
    queue: YandexQueue;
    userId: string;
    services: ImportStrategyArgs['services'];
  }): Promise<{ id: string; identifier: string }> {
    const { tenantId, queue, userId, services } = args;

    const slugBase = slugify(queue.name) || 'imported';
    const identifierBase = (queue.key ?? makeIdentifier(queue.name)).toUpperCase().slice(0, 5);

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
        name: queue.name,
        description: queue.description ?? null,
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

  private async createStatesForQueue(args: {
    tenantId: string;
    projectId: string;
    queue: YandexQueue;
    services: ImportStrategyArgs['services'];
  }): Promise<Map<string, string>> {
    const { tenantId, projectId, queue, services } = args;
    const stateByName = new Map<string, string>();
    const statuses = Array.isArray(queue.workflowStatuses) ? queue.workflowStatuses : [];
    if (statuses.length === 0) {
      const defaults = [
        { name: 'Открыт', category: 'unstarted' as const, isDefault: true },
        { name: 'В работе', category: 'started' as const, isDefault: false },
        {
          name: 'Готово',
          category: 'completed' as const,
          isDefault: false,
        },
      ];
      let firstId: string | null = null;
      for (let i = 0; i < defaults.length; i++) {
        const d = defaults[i]!;
        const c = await services.prisma.issueState.create({
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
        stateByName.set(d.name, c.id);
        if (d.isDefault) firstId = c.id;
      }
      if (firstId) {
        await services.prisma.project
          .update({ where: { id: projectId }, data: { defaultStateId: firstId } })
          .catch(() => undefined);
      }
      return stateByName;
    }

    let firstStateId: string | null = null;
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i]!;
      const category = mapStatusCategory(s.type);
      const isDefault = i === 0;
      const created = await services.prisma.issueState.create({
        data: {
          tenantId,
          projectId,
          name: (s.display ?? s.key ?? `Status ${i + 1}`).slice(0, 50),
          color: categoryColor(category),
          category,
          sequence: i + 1,
          isDefault,
        },
        select: { id: true },
      });
      const lookupName = (s.display ?? s.key ?? '').toString();
      stateByName.set(lookupName, created.id);
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
    return stateByName;
  }

  private async ensureLabel(args: {
    tenantId: string;
    projectId: string;
    name: string;
    labelByName: Map<string, string>;
    services: ImportStrategyArgs['services'];
  }): Promise<string | null> {
    const { tenantId, projectId, name, labelByName, services } = args;
    const key = name.slice(0, 50);
    const cached = labelByName.get(key);
    if (cached) return cached;
    try {
      const created = await services.prisma.label.create({
        data: {
          tenantId,
          projectId,
          name: key,
          color: '#94A3B8',
        },
        select: { id: true },
      });
      labelByName.set(key, created.id);
      return created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await services.prisma.label.findFirst({
          where: { tenantId, projectId, name: key },
          select: { id: true },
        });
        if (existing) {
          labelByName.set(key, existing.id);
          return existing.id;
        }
      }
      throw err;
    }
  }

  private async downloadAttachment(args: {
    attachment: YandexAttachment;
    issueId: string;
    uploaderId: string;
    client: YandexTrackerClient;
    services: ImportStrategyArgs['services'];
  }): Promise<boolean> {
    const { attachment, issueId, uploaderId, client, services } = args;
    if (!attachment.id) return false;

    let buffer: Buffer;
    let mimeType = attachment.mimetype ?? attachment.metadata?.type ?? 'application/octet-stream';
    try {
      const downloaded = await client.downloadAttachment(attachment);
      if (!downloaded) return false;
      if (downloaded.size === 0) return false;
      if (downloaded.size > YandexTrackerImportStrategy.MAX_ATTACHMENT_BYTES) {
        this.logger.warn(
          {
            attachmentId: attachment.id,
            size: downloaded.size,
          },
          'yandex-tracker-import: attachment слишком большой — skip',
        );
        return false;
      }
      buffer = downloaded.buffer;
      if (downloaded.contentType) mimeType = downloaded.contentType;
    } catch (err) {
      this.logger.warn(
        {
          attachmentId: attachment.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'yandex-tracker-import: fetch attachment failed — skip',
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
          attachmentId: attachment.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'yandex-tracker-import: S3 putObject failed — skip',
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

  private async linkParent(args: {
    issue: YandexIssue;
    ourIssueId: string;
    issueIdByYandexId: Map<string, string>;
    yandexIdByKey: Map<string, string>;
    services: ImportStrategyArgs['services'];
  }): Promise<void> {
    const { issue, ourIssueId, issueIdByYandexId, yandexIdByKey, services } = args;
    const parent = issue.parent;
    if (!parent) return;
    let parentYandexId: string | undefined;
    if (typeof parent === 'string') {
      parentYandexId = yandexIdByKey.get(parent);
    } else if (typeof parent === 'object' && parent) {
      if ('id' in parent && typeof parent.id === 'string') parentYandexId = parent.id;
      else if ('key' in parent && typeof parent.key === 'string')
        parentYandexId = yandexIdByKey.get(parent.key);
    }
    if (!parentYandexId) return;
    const parentOurId = issueIdByYandexId.get(parentYandexId);
    if (!parentOurId) return;
    await services.prisma.issue
      .update({
        where: { id: ourIssueId },
        data: { parentId: parentOurId },
      })
      .catch(() => undefined);
  }

  private async linkRelations(args: {
    issue: YandexIssue;
    tenantId: string;
    ourIssueId: string;
    issueIdByYandexId: Map<string, string>;
    yandexIdByKey: Map<string, string>;
    userId: string;
    client: YandexTrackerClient;
    services: ImportStrategyArgs['services'];
  }): Promise<number> {
    const { issue, ourIssueId, issueIdByYandexId, yandexIdByKey, userId, client, services } = args;
    const links = await client.getIssueLinks(issue.key ?? issue.id);
    let created = 0;
    for (const link of links) {
      const target = link.object;
      if (!target) continue;
      const targetYandexId =
        (typeof target === 'object' && target.id) ||
        (typeof target === 'object' && target.key ? yandexIdByKey.get(target.key) : undefined) ||
        (typeof target === 'string' ? yandexIdByKey.get(target) : undefined);
      if (!targetYandexId) continue;
      const targetOurId = issueIdByYandexId.get(targetYandexId);
      if (!targetOurId) continue;

      const relationType = mapLinkType(link.type?.id ?? link.type?.inward ?? '');
      if (!relationType) continue;
      try {
        await services.prisma.issueRelation.create({
          data: {
            sourceIssueId: ourIssueId,
            targetIssueId: targetOurId,
            relationType,
            createdById: userId,
          },
        });
        created += 1;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
    }
    return created;
  }

  private cap(_errors: ImportErrorEntry[], entry: ImportErrorEntry): ImportErrorEntry {
    return entry;
  }

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

interface YandexClientOptions {
  oauthToken: string;
  orgId?: string;
  logger: Logger;
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

class YandexTrackerClient {
  constructor(private readonly opts: YandexClientOptions) {}

  async getQueue(queueId: string): Promise<YandexQueue> {
    return this.requestJson<YandexQueue>(`/queues/${encodeURIComponent(queueId)}`);
  }

  async listIssuesByQueue(queueId: string): Promise<YandexIssue[]> {
    const all: YandexIssue[] = [];
    let page = 1;
    const MAX_PAGES = 1_000;
    for (; page <= MAX_PAGES; page++) {
      const search = new URLSearchParams({
        perPage: String(YandexTrackerImportStrategy['PAGE_SIZE']),
        page: String(page),
      });
      const url = `/issues/_search?${search.toString()}`;
      const res = await this.requestRaw(url, {
        method: 'POST',
        body: JSON.stringify({
          filter: { queue: queueId },
        }),
      });
      const items = (await res.json()) as YandexIssue[];
      if (!Array.isArray(items) || items.length === 0) break;
      all.push(...items);
      const totalPages = Number(res.headers.get('x-total-pages') ?? '0');
      if (totalPages > 0 && page >= totalPages) break;
      if (items.length < YandexTrackerImportStrategy['PAGE_SIZE']) break;
    }
    return all;
  }

  async getIssueComments(issueKeyOrId: string): Promise<YandexComment[]> {
    return this.requestJson<YandexComment[]>(
      `/issues/${encodeURIComponent(issueKeyOrId)}/comments`,
    ).catch((err) => {
      if (err instanceof YandexApiError && (err.status === 404 || err.status === 403)) {
        return [];
      }
      throw err;
    });
  }

  async getIssueAttachments(issueKeyOrId: string): Promise<YandexAttachment[]> {
    return this.requestJson<YandexAttachment[]>(
      `/issues/${encodeURIComponent(issueKeyOrId)}/attachments`,
    ).catch((err) => {
      if (err instanceof YandexApiError && (err.status === 404 || err.status === 403)) {
        return [];
      }
      throw err;
    });
  }

  async getIssueLinks(issueKeyOrId: string): Promise<YandexLink[]> {
    return this.requestJson<YandexLink[]>(
      `/issues/${encodeURIComponent(issueKeyOrId)}/links`,
    ).catch((err) => {
      if (err instanceof YandexApiError && (err.status === 404 || err.status === 403)) {
        return [];
      }
      throw err;
    });
  }

  async downloadAttachment(
    att: YandexAttachment,
  ): Promise<{ buffer: Buffer; size: number; contentType?: string } | null> {
    const contentUrl = att.content?.url ?? att.contentUrl ?? null;
    let url: string;
    if (contentUrl) {
      url = contentUrl.startsWith('http')
        ? contentUrl
        : `${YandexTrackerImportStrategy['API_BASE']}${contentUrl}`;
    } else if (att.id && att.name) {
      return null;
    } else {
      return null;
    }

    const res = await this.requestRaw(url, { method: 'GET' }, { absolute: true });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? undefined;
    return { buffer: buf, size: buf.byteLength, contentType: ct?.split(';')[0]?.trim() };
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.requestRaw(path, init);
    return (await res.json()) as T;
  }

  private async requestRaw(
    path: string,
    init?: RequestInit,
    opts: { absolute?: boolean } = {},
  ): Promise<Response> {
    const url = opts.absolute ? path : `${YandexTrackerImportStrategy['API_BASE']}${path}`;
    const headers = new Headers(init?.headers ?? {});
    headers.set('Authorization', `OAuth ${this.opts.oauthToken}`);
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');
    if (this.opts.orgId) headers.set('X-Org-ID', this.opts.orgId);

    const maxAttempts = YandexTrackerImportStrategy['MAX_RETRY_ATTEMPTS'];
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        YandexTrackerImportStrategy['REQUEST_TIMEOUT_MS'],
      );
      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, {
          ...init,
          headers,
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
            'yandex-tracker: HTTP ' + res.status + ' — backoff retry',
          );
          await sleep(waitMs);
          continue;
        }
      }

      const bodyText = await res.text().catch(() => '');
      throw new YandexApiError(
        `Yandex Tracker API ${res.status} ${res.statusText} on ${url}: ${bodyText.slice(0, 500)}`,
        res.status,
      );
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'yandex-tracker: unknown fetch error'));
  }
}

class YandexApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'YandexApiError';
  }
}

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
  const words = ascii
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return `Q${Math.floor(Math.random() * 9000 + 1000)}`;
  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0]!)
      .join('')
      .slice(0, 5);
  }
  const single = words[0]!;
  return single.slice(0, 5).padEnd(3, 'X');
}

function safeParseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapPriority(key?: string | null): string {
  if (!key) return 'none';
  switch (key.toLowerCase()) {
    case 'critical':
    case 'blocker':
      return 'urgent';
    case 'major':
    case 'high':
      return 'high';
    case 'normal':
    case 'medium':
      return 'medium';
    case 'minor':
    case 'low':
    case 'trivial':
      return 'low';
    default:
      return 'none';
  }
}

function mapStatusCategory(
  type?: string | null,
): 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' {
  if (!type) return 'unstarted';
  switch (type.toLowerCase()) {
    case 'new':
    case 'open':
      return 'unstarted';
    case 'inprogress':
    case 'in_progress':
      return 'started';
    case 'resolved':
    case 'closed':
    case 'completed':
    case 'done':
      return 'completed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'backlog':
      return 'backlog';
    default:
      return 'unstarted';
  }
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

function mapLinkType(typeId: string): string | null {
  if (!typeId) return null;
  const key = typeId.toLowerCase();
  if (key.includes('blocks')) {
    return key.includes('blocked') ? 'blocked_by' : 'blocks';
  }
  if (key.includes('duplicat')) {
    return key.includes('duplicated') ? 'duplicated_by' : 'duplicates';
  }
  if (key.includes('relates')) return 'relates_to';
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = 1_000 * Math.pow(2, attempt - 1);
  return Math.min(base, 16_000);
}

interface YandexQueue {
  id?: string;
  key?: string;
  name: string;
  description?: string | null;
  workflowStatuses?: YandexStatus[];
}

interface YandexStatus {
  key?: string;
  display?: string;
  type?: string;
}

interface YandexIssue {
  id: string;
  key?: string;
  summary?: string;
  description?: string | null;
  assignee?: { id?: string; email?: string | null; display?: string } | null;
  status?: { key?: string; display?: string };
  priority?: { key?: string; display?: string };
  tags?: string[];
  deadline?: string | null;
  parent?: string | { id?: string; key?: string; display?: string } | null;
}

interface YandexComment {
  id?: string;
  text?: string;
  createdBy?: { id?: string; email?: string | null };
  createdAt?: string;
}

interface YandexAttachment {
  id?: string;
  name?: string;
  size?: number;
  mimetype?: string;
  metadata?: { type?: string };
  content?: { url?: string } | null;
  contentUrl?: string;
}

interface YandexLink {
  id?: string;
  type?: { id?: string; inward?: string; outward?: string };
  object?: string | { id?: string; key?: string; display?: string };
}
