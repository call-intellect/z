import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ProvenanceService } from '../../knowledge-core/services/provenance.service';
import {
  buildIssueProgressDraftUserMessage,
  ISSUE_PROGRESS_DRAFT_JSON_SCHEMA,
  ISSUE_PROGRESS_DRAFT_SCHEMA_NAME,
  ISSUE_PROGRESS_DRAFT_SYSTEM_PROMPT,
  IssueProgressDraftResponseSchema,
  type IssueProgressDraftResponse,
  type IssueProgressDraftSignal,
} from '../prompts/issue-progress-draft.prompt';

interface IssueSignals {
  signals: IssueProgressDraftSignal[];
  sourceBlockIds: string[];
}

interface RunSummary {
  scannedOrgs: number;
  scannedIssues: number;
  drafted: number;
  belowThreshold: number;
  dedupSkipped: number;
  existingPendingSkipped: number;
}

@Injectable()
export class ProgressAutoDraftCron {
  private readonly logger = new Logger(ProgressAutoDraftCron.name);

  private static readonly DEFAULT_MIN_SIGNALS = 2;
  private static readonly DEFAULT_DEDUP_TTL_SECONDS = 86_400;
  private static readonly DEFAULT_LOOKBACK_DAYS = 7;
  private static readonly ISSUES_PER_ORG_LIMIT = 200;
  private static readonly LLM_RETRIES = 2;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(ProvenanceService)
    private readonly provenance?: ProvenanceService,
  ) {}

  @Cron('0 7 * * *')
  async runScheduled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.progressAutoDraftEnabled',
      'TRACKER_PROGRESS_AUTO_DRAFT_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('progress-auto-draft: выключен — пропуск');
      return;
    }
    try {
      const summary = await this.run();
      this.logger.debug(summary, 'progress-auto-draft: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'progress-auto-draft: непойманная ошибка',
      );
    }
  }

  async run(): Promise<RunSummary> {
    const minSignals = await this.minSignals();
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const todayKey = this.todayKey();

    const summary: RunSummary = {
      scannedOrgs: orgs.length,
      scannedIssues: 0,
      drafted: 0,
      belowThreshold: 0,
      dedupSkipped: 0,
      existingPendingSkipped: 0,
    };

    for (const org of orgs) {
      let issues: Array<{
        id: string;
        tenantId: string;
        title: string;
        descriptionStripped: string | null;
      }>;
      try {
        issues = await this.prisma.issue.findMany({
          where: {
            tenantId: org.id,
            deletedAt: null,
            state: { category: 'started' },
          },
          select: {
            id: true,
            tenantId: true,
            title: true,
            descriptionStripped: true,
          },
          take: ProgressAutoDraftCron.ISSUES_PER_ORG_LIMIT,
        });
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'progress-auto-draft: ошибка загрузки задач — пропускаю Org',
        );
        continue;
      }

      for (const issue of issues) {
        summary.scannedIssues += 1;
        try {
          const handled = await this.processIssue({
            issue,
            minSignals,
            todayKey,
          });
          if (handled === 'drafted') summary.drafted += 1;
          else if (handled === 'below_threshold') summary.belowThreshold += 1;
          else if (handled === 'dedup') summary.dedupSkipped += 1;
          else if (handled === 'existing_pending')
            summary.existingPendingSkipped += 1;
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              issueId: issue.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'progress-auto-draft: ошибка обработки задачи — пропускаю',
          );
        }
      }
    }

    return summary;
  }

  private async processIssue(args: {
    issue: {
      id: string;
      tenantId: string;
      title: string;
      descriptionStripped: string | null;
    };
    minSignals: number;
    todayKey: string;
  }): Promise<
    'drafted' | 'below_threshold' | 'dedup' | 'existing_pending'
  > {
    const { issue } = args;

    const since = await this.lastProgressAt(issue.id, issue.tenantId);
    const { signals, sourceBlockIds } = await this.collectSignals({
      issueId: issue.id,
      tenantId: issue.tenantId,
      since,
    });
    if (signals.length < args.minSignals) return 'below_threshold';

    if (await this.hasPendingDraft(issue.id, issue.tenantId)) {
      return 'existing_pending';
    }

    const dedupOk = await this.dedupAcquire(issue.id, args.todayKey);
    if (!dedupOk) return 'dedup';

    const draft = await this.formulate({
      tenantId: issue.tenantId,
      title: issue.title,
      description: issue.descriptionStripped,
      signals,
    });
    if (!draft) return 'below_threshold';

    const snapshot = await this.computeSnapshot(issue.tenantId, sourceBlockIds);

    await this.prisma.issueProgressUpdate.create({
      data: {
        tenantId: issue.tenantId,
        issueId: issue.id,
        authorType: 'ai_agent',
        draftState: 'pending',
        health: draft.health,
        body: draft.body.slice(0, 2_000),
        doneText: draft.doneText.trim() ? draft.doneText.slice(0, 2_000) : null,
        nextText: draft.nextText.trim() ? draft.nextText.slice(0, 2_000) : null,
        sourceBlockIds,
        evidenceQuote: this.composeEvidence(signals),
        confidence: new Prisma.Decimal(draft.confidence.toFixed(3)),
        previewQuote: snapshot.previewQuote,
        previewSourceRef: this.toJson(snapshot.previewSourceRef),
      },
    });

    this.logger.log(
      {
        tenantId: issue.tenantId,
        issueId: issue.id,
        signals: signals.length,
        sourceBlocks: sourceBlockIds.length,
        health: draft.health,
      },
      'progress-auto-draft: создан авто-черновик прогресса (pending)',
    );
    return 'drafted';
  }

  private async lastProgressAt(
    issueId: string,
    tenantId: string,
  ): Promise<Date | null> {
    const last = await this.prisma.issueProgressUpdate.findFirst({
      where: { issueId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last) return last.createdAt;
    const fallback = new Date(
      Date.now() -
        ProgressAutoDraftCron.DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000,
    );
    return fallback;
  }

  private async collectSignals(args: {
    issueId: string;
    tenantId: string;
    since: Date | null;
  }): Promise<IssueSignals> {
    const sinceFilter = args.since ? { gt: args.since } : undefined;

    const checklistItems = await this.prisma.issueChecklistItem.findMany({
      where: {
        tenantId: args.tenantId,
        isDone: true,
        ...(sinceFilter ? { completedAt: sinceFilter } : {}),
        checklist: { issueId: args.issueId },
      },
      select: { text: true, completedAt: true },
      orderBy: { completedAt: 'asc' },
      take: 50,
    });

    const statusChanges = await this.prisma.issueActivity.findMany({
      where: {
        tenantId: args.tenantId,
        issueId: args.issueId,
        verb: 'status_changed',
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
      select: { oldValue: true, newValue: true },
      orderBy: { epoch: 'asc' },
      take: 20,
    });

    const candidates = await this.prisma.taskClosureCandidate.findMany({
      where: {
        tenantId: args.tenantId,
        issueId: args.issueId,
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
      select: { sourceBlockId: true, evidenceQuote: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const signals: IssueProgressDraftSignal[] = [];
    for (const item of checklistItems) {
      signals.push({
        label: 'выполнен пункт чек-листа',
        detail: item.text.slice(0, 300),
      });
    }
    for (const change of statusChanges) {
      signals.push({
        label: 'сменился статус задачи',
        detail: this.describeStatusChange(change.oldValue, change.newValue),
      });
    }
    const sourceBlockIds: string[] = [];
    for (const c of candidates) {
      sourceBlockIds.push(c.sourceBlockId);
      signals.push({
        label: 'упоминание задачи в графе знаний',
        detail: (c.evidenceQuote ?? '').slice(0, 300),
      });
    }

    return {
      signals,
      sourceBlockIds: [...new Set(sourceBlockIds)],
    };
  }

  private describeStatusChange(oldValue: unknown, newValue: unknown): string {
    const from = this.stringifyValue(oldValue);
    const to = this.stringifyValue(newValue);
    if (from && to) return `${from} → ${to}`;
    if (to) return `новый статус: ${to}`;
    return 'статус изменён';
  }

  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.slice(0, 100);
    if (typeof value === 'object') {
      const name = (value as { name?: unknown }).name;
      if (typeof name === 'string') return name.slice(0, 100);
    }
    return String(value).slice(0, 100);
  }

  private composeEvidence(signals: IssueProgressDraftSignal[]): string {
    return signals
      .map((s) => `${s.label}: ${s.detail}`.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 2_000);
  }

  private async formulate(args: {
    tenantId: string;
    title: string;
    description: string | null;
    signals: IssueProgressDraftSignal[];
  }): Promise<IssueProgressDraftResponse | null> {
    const userMessage = buildIssueProgressDraftUserMessage({
      title: args.title,
      description: args.description,
      signals: args.signals,
    });

    for (let attempt = 0; attempt < ProgressAutoDraftCron.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'issue-progress-draft',
          tenantId: args.tenantId,
          systemPrompt: ISSUE_PROGRESS_DRAFT_SYSTEM_PROMPT,
          userMessage,
          responseFormat: {
            type: 'json_schema',
            name: ISSUE_PROGRESS_DRAFT_SCHEMA_NAME,
            strict: true,
            schema: ISSUE_PROGRESS_DRAFT_JSON_SCHEMA,
          },
          dataClass: 'internal',
          validate: (text) => this.parse(text) !== null,
        });
        const parsed = this.parse(out.text);
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'progress-auto-draft: LLM упал — повтор',
        );
      }
    }
    return null;
  }

  private parse(text: string): IssueProgressDraftResponse | null {
    const raw = tryParseJson(text);
    const parsed = IssueProgressDraftResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  }

  private async computeSnapshot(
    tenantId: string,
    sourceBlockIds: string[],
  ): Promise<{ previewQuote: string | null; previewSourceRef: unknown }> {
    if (!this.provenance || sourceBlockIds.length === 0) {
      return { previewQuote: null, previewSourceRef: null };
    }
    try {
      return await this.provenance.computePreviewSnapshot(
        tenantId,
        sourceBlockIds,
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'progress-auto-draft: computePreviewSnapshot упал — без снимка источника',
      );
      return { previewQuote: null, previewSourceRef: null };
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }

  private async hasPendingDraft(
    issueId: string,
    tenantId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.issueProgressUpdate.findFirst({
      where: {
        issueId,
        tenantId,
        authorType: 'ai_agent',
        draftState: 'pending',
        deletedAt: null,
      },
      select: { id: true },
    });
    return existing !== null;
  }

  private async dedupAcquire(issueId: string, dayKey: string): Promise<boolean> {
    const key = `progress_auto_draft:${issueId}:${dayKey}`;
    try {
      const res = await this.redis.client.set(
        key,
        '1',
        'EX',
        ProgressAutoDraftCron.DEFAULT_DEDUP_TTL_SECONDS,
        'NX',
      );
      return res !== null;
    } catch (err) {
      this.logger.warn(
        {
          issueId,
          dayKey,
          err: err instanceof Error ? err.message : String(err),
        },
        'progress-auto-draft: Redis SETNX упал — продолжаю без дедупа',
      );
      return true;
    }
  }

  private async minSignals(): Promise<number> {
    const v = await this.cfg
      .getDynamic<number>(
        'tracker.progressAutoDraftMinSignals',
        undefined,
        ProgressAutoDraftCron.DEFAULT_MIN_SIGNALS,
      )
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v >= 1
      ? Math.floor(v)
      : ProgressAutoDraftCron.DEFAULT_MIN_SIGNALS;
  }

  private todayKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
