import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  ISSUE_ACTIVITY_DIGEST_SYSTEM_PROMPT,
  buildIssueActivityDigestUserMessage,
  type IssueActivityDigestPoint,
} from '../prompts/issue-activity-digest.prompt';

import { IssuesService } from './issues.service';

export interface IssueActivityDigestDto {
  summary: string;
  points: string[];
  hasChanges: boolean;
  since: string | null;
  generatedAt: string;
}

interface DigestArgs {
  issueId: string;
  tenantId: string;
  since?: Date | null;
}

interface DigestAggregate {
  sinceLabel: string | null;
  statusChanges: number;
  assigneeChanges: number;
  dueDateChanges: number;
  checklistDone: number;
  newComments: number;
  newProgressUpdates: number;
  points: IssueActivityDigestPoint[];
  total: number;
}

@Injectable()
export class IssueActivityDigestService {
  private readonly logger = new Logger(IssueActivityDigestService.name);

  private static readonly CACHE_TTL_SECONDS = 90;
  private static readonly DEFAULT_LOOKBACK_DAYS = 14;
  private static readonly ACTIVITY_LIMIT = 80;
  private static readonly POINTS_LIMIT = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(LlmRouterService)
    private readonly llm?: LlmRouterService,
    @Optional() @Inject(RedisService) private readonly redis?: RedisService,
  ) {}

  async getActivityDigest(args: DigestArgs): Promise<IssueActivityDigestDto> {
    const issue = await this.issues.requireIssue(args.issueId, args.tenantId);

    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.activityDigestEnabled',
      undefined,
      true,
    );
    if (!enabled) {
      return {
        summary: 'Сводка изменений сейчас выключена администратором.',
        points: [],
        hasChanges: false,
        since: args.since ? args.since.toISOString() : null,
        generatedAt: new Date().toISOString(),
      };
    }

    const since = this.resolveSince(args.since);
    const sinceKey = since ? since.toISOString() : 'all';
    const cacheKey = `issue:activity-digest:${args.issueId}:${sinceKey}`;

    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as IssueActivityDigestDto;
        }
      } catch (err) {
        this.logger.debug(
          {
            issueId: args.issueId,
            err: err instanceof Error ? err.message : String(err),
          },
          'issue-activity-digest: cache read failed',
        );
      }
    }

    const aggregate = await this.aggregate({
      issueId: args.issueId,
      tenantId: args.tenantId,
      since,
    });

    let dto: IssueActivityDigestDto;
    if (aggregate.total === 0) {
      dto = {
        summary: 'С прошлого захода по задаче ничего не менялось.',
        points: [],
        hasChanges: false,
        since: since ? since.toISOString() : null,
        generatedAt: new Date().toISOString(),
      };
    } else {
      const summary = await this.summarize(args.tenantId, issue.title, aggregate);
      dto = {
        summary,
        points: aggregate.points.map((p) =>
          p.at ? `${p.detail} (${p.at})` : p.detail,
        ),
        hasChanges: true,
        since: since ? since.toISOString() : null,
        generatedAt: new Date().toISOString(),
      };
    }

    if (this.redis) {
      try {
        await this.redis.client.set(
          cacheKey,
          JSON.stringify(dto),
          'EX',
          IssueActivityDigestService.CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.debug(
          {
            issueId: args.issueId,
            err: err instanceof Error ? err.message : String(err),
          },
          'issue-activity-digest: cache write failed',
        );
      }
    }

    return dto;
  }

  private resolveSince(explicit?: Date | null): Date | null {
    if (explicit) return explicit;
    return new Date(
      Date.now() -
        IssueActivityDigestService.DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000,
    );
  }

  private async aggregate(args: {
    issueId: string;
    tenantId: string;
    since: Date | null;
  }): Promise<DigestAggregate> {
    const sinceFilter = args.since ? { gt: args.since } : undefined;

    const activities = await this.prisma.issueActivity.findMany({
      where: {
        tenantId: args.tenantId,
        issueId: args.issueId,
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
      select: {
        verb: true,
        field: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
      },
      orderBy: { epoch: 'asc' },
      take: IssueActivityDigestService.ACTIVITY_LIMIT,
    });

    const newComments = await this.prisma.issueComment.count({
      where: {
        issueId: args.issueId,
        deletedAt: null,
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
    });

    const newProgressUpdates = await this.prisma.issueProgressUpdate.count({
      where: {
        tenantId: args.tenantId,
        issueId: args.issueId,
        deletedAt: null,
        draftState: null,
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
    });

    const points: IssueActivityDigestPoint[] = [];
    let statusChanges = 0;
    let assigneeChanges = 0;
    let dueDateChanges = 0;
    let checklistDone = 0;

    for (const a of activities) {
      const at = this.dateLabel(a.createdAt);
      switch (a.verb) {
        case 'status_changed':
          statusChanges++;
          points.push({
            label: 'статус',
            detail: `Сменился статус: ${this.describeChange(a.oldValue, a.newValue)}`,
            at,
          });
          break;
        case 'assigned':
          assigneeChanges++;
          points.push({
            label: 'исполнитель',
            detail: `Назначен исполнитель: ${this.stringifyValue(a.newValue) || 'обновлён'}`,
            at,
          });
          break;
        case 'unassigned':
          assigneeChanges++;
          points.push({ label: 'исполнитель', detail: 'Снят исполнитель', at });
          break;
        case 'checklist_completed':
          checklistDone++;
          points.push({
            label: 'чек-лист',
            detail: `Закрыт пункт чек-листа: ${this.stringifyValue(a.newValue) || ''}`.trim(),
            at,
          });
          break;
        default:
          if (a.field === 'dueDate' || a.field === 'startDate') {
            dueDateChanges++;
            points.push({
              label: 'срок',
              detail: `Изменён срок: ${this.describeChange(a.oldValue, a.newValue)}`,
              at,
            });
          } else if (
            a.verb === 'goal_linked' ||
            a.verb === 'goal_unlinked' ||
            a.verb === 'label_added' ||
            a.verb === 'label_removed' ||
            a.verb === 'related' ||
            a.verb === 'attached'
          ) {
            points.push({
              label: 'связь',
              detail: this.describeVerb(a.verb, a.newValue),
              at,
            });
          }
          break;
      }
    }

    if (newComments > 0) {
      points.push({
        label: 'комментарии',
        detail: `Новых комментариев: ${newComments}`,
        at: null,
      });
    }
    if (newProgressUpdates > 0) {
      points.push({
        label: 'прогресс',
        detail: `Опубликовано обновлений прогресса: ${newProgressUpdates}`,
        at: null,
      });
    }

    const total =
      statusChanges +
      assigneeChanges +
      dueDateChanges +
      checklistDone +
      newComments +
      newProgressUpdates +
      points.filter((p) => p.label === 'связь').length;

    return {
      sinceLabel: args.since ? this.dateLabel(args.since) : null,
      statusChanges,
      assigneeChanges,
      dueDateChanges,
      checklistDone,
      newComments,
      newProgressUpdates,
      points: points.slice(0, IssueActivityDigestService.POINTS_LIMIT),
      total,
    };
  }

  private async summarize(
    tenantId: string,
    title: string,
    aggregate: DigestAggregate,
  ): Promise<string> {
    const fallback = aggregate.points
      .map((p) => (p.at ? `— ${p.detail} (${p.at})` : `— ${p.detail}`))
      .join('\n');

    if (!this.llm) return fallback;

    try {
      const result = await this.llm.call({
        taskType: 'issue-activity-digest',
        tenantId,
        systemPrompt: ISSUE_ACTIVITY_DIGEST_SYSTEM_PROMPT,
        userMessage: buildIssueActivityDigestUserMessage({
          title,
          sinceLabel: aggregate.sinceLabel,
          statusChanges: aggregate.statusChanges,
          assigneeChanges: aggregate.assigneeChanges,
          dueDateChanges: aggregate.dueDateChanges,
          checklistDone: aggregate.checklistDone,
          newComments: aggregate.newComments,
          newProgressUpdates: aggregate.newProgressUpdates,
          points: aggregate.points,
        }),
        maxTokens: 600,
        sourceRef: { type: 'issue-activity-digest', id: title },
      });
      const text = result.text.trim();
      return text.length > 0 ? text : fallback;
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'issue-activity-digest: LLM summary failed, using fallback',
      );
      return fallback;
    }
  }

  private describeChange(oldValue: unknown, newValue: unknown): string {
    const from = this.stringifyValue(oldValue);
    const to = this.stringifyValue(newValue);
    if (from && to) return `${from} → ${to}`;
    if (to) return to;
    return 'обновлено';
  }

  private describeVerb(verb: string, newValue: unknown): string {
    const value = this.stringifyValue(newValue);
    switch (verb) {
      case 'goal_linked':
        return `Привязана цель${value ? `: ${value}` : ''}`;
      case 'goal_unlinked':
        return 'Отвязана цель';
      case 'label_added':
        return `Добавлена метка${value ? `: ${value}` : ''}`;
      case 'label_removed':
        return 'Снята метка';
      case 'related':
        return 'Добавлена связь с задачей';
      case 'attached':
        return 'Прикреплён файл';
      default:
        return 'Изменена связь';
    }
  }

  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.slice(0, 120);
    if (typeof value === 'object') {
      const name = (value as { name?: unknown; title?: unknown }).name;
      if (typeof name === 'string') return name.slice(0, 120);
      const titleVal = (value as { title?: unknown }).title;
      if (typeof titleVal === 'string') return titleVal.slice(0, 120);
    }
    return String(value).slice(0, 120);
  }

  private dateLabel(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
    }).format(date);
  }
}
