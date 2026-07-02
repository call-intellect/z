import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { CORE_QUEUE_NAMES, type StrategicAlignmentJobData } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import {
  buildGoalAlignmentMessages,
  GOAL_ALIGNMENT_JSON_SCHEMA,
  GOAL_ALIGNMENT_TASK_TYPE,
  GoalAlignmentResponseSchema,
  type GoalAlignmentBlockInput,
  type GoalAlignmentThemeInput,
} from '../prompts/goal-alignment.prompt';

const WORKER_NAME = 'strategic-alignment';
const MAX_BLOCKS = 200;
const PREV_SNAPSHOT_MIN_HOURS = 20;
const PREV_SNAPSHOT_MAX_HOURS = 50;
const ALERT_DELTA_THRESHOLD = -15;
const ALERT_SCORE_THRESHOLD = 60;

@Injectable()
export class StrategicAlignmentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategicAlignmentWorker.name);
  private worker: Worker<StrategicAlignmentJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  onModuleInit(): void {
    this.worker = new Worker<StrategicAlignmentJobData>(
      CORE_QUEUE_NAMES.STRATEGIC_ALIGNMENT,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.strategic-alignment', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          goalId: job?.data?.goalId,
          tenantId: job?.data?.tenantId,
          attempts: job?.attemptsMade,
          err: err.message,
        },
        'strategic-alignment: job failed',
      );
    });
    this.logger.debug(`StrategicAlignmentWorker запущен (${CORE_QUEUE_NAMES.STRATEGIC_ALIGNMENT})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<StrategicAlignmentJobData>): Promise<void> {
    const { tenantId, goalId, manual, windowDays: windowOverride } = job.data;

    await this.gate.checkOrThrow(tenantId, WORKER_NAME);

    const [goal, org] = await Promise.all([
      this.prisma.goal.findUnique({
        where: { id: goalId },
        include: {
          themes: {
            include: {
              theme: {
                select: {
                  id: true,
                  name: true,
                  weight: true,
                  dynamic: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.org.findUnique({
        where: { id: tenantId },
        select: {
          deletedAt: true,
          strategicAlignmentWindowDays: true,
        },
      }),
    ]);

    if (!goal || goal.tenantId !== tenantId) {
      this.logger.debug({ goalId, tenantId }, 'goal не найден — skip');
      return;
    }
    if (goal.archivedAt || goal.status !== 'active') {
      this.logger.debug({ goalId, status: goal.status }, 'goal неактивен — skip');
      return;
    }
    if (!org || org.deletedAt) {
      this.logger.debug({ tenantId }, 'Org удалена — skip');
      return;
    }

    const windowDays = clamp(windowOverride ?? org.strategicAlignmentWindowDays, 7, 90);

    const activeThemeLinks = goal.themes.filter((gt) => gt.theme.status === 'active');
    const themesCount = activeThemeLinks.length;

    if (themesCount === 0) {
      void this.audit.log({
        action: 'goal.alignment.skipped',
        resourceId: goalId,
        metadata: { tenantId, reason: 'no_themes', manual: manual ?? false },
      });
      return;
    }

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const themeIds = activeThemeLinks.map((gt) => gt.theme.id);

    const blocks = await this.fetchBlocksForThemes({
      tenantId,
      themeIds,
      since,
    });

    const themesPayload: GoalAlignmentThemeInput[] = activeThemeLinks.map((gt) => ({
      id: gt.theme.id,
      name: gt.theme.name,
      weight: decimalToNumber(gt.theme.weight),
      dynamic: gt.theme.dynamic,
    }));
    const blocksPayload: GoalAlignmentBlockInput[] = blocks.map((b) => ({
      signalType: b.signalType,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
    }));

    const daysUntilTarget = goal.targetDate
      ? Math.ceil((goal.targetDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    const { systemPrompt, userMessage } = buildGoalAlignmentMessages({
      goalName: goal.name,
      goalDescription: goal.description,
      daysUntilTarget,
      windowDays,
      themes: themesPayload,
      blocks: blocksPayload,
    });

    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const guardedUser = guardOn ? wrapUserData(userMessage) : userMessage;
    let rawText: string;
    try {
      const result = await this.llm.call({
        taskType: GOAL_ALIGNMENT_TASK_TYPE,
        tenantId,
        systemPrompt: guardedSystem,
        userMessage: guardedUser,
        sourceRef: { type: 'goal', id: goalId },
        responseFormat: {
          type: 'json_schema',
          name: 'GoalAlignment',
          schema: GOAL_ALIGNMENT_JSON_SCHEMA,
          strict: true,
        },
        maxTokens: 2_000,
      });
      rawText = result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { goalId, tenantId, err: message },
        'strategic-alignment: LLM-вызов упал — snapshot не создаём (ретрай)',
      );
      void this.audit.log({
        action: 'goal.alignment.failed',
        resourceId: goalId,
        metadata: {
          tenantId,
          manual: manual ?? false,
          error: message.slice(0, 500),
        },
      });
      throw err;
    }

    const parseResult = parseLlmResponse(rawText);
    if (!parseResult.ok) {
      this.logger.warn(
        { goalId, tenantId, reason: parseResult.reason },
        'strategic-alignment: ответ LLM не разобран — graceful skip (job НЕ падает)',
      );
      this.metrics.incStrategicAlignmentParseSkip({ reason: parseResult.reason });
      void this.audit.log({
        action: 'goal.alignment.parse_skipped',
        resourceId: goalId,
        metadata: {
          tenantId,
          manual: manual ?? false,
          reason: parseResult.reason,
        },
      });
      return;
    }
    const parsed = parseResult.data;

    const prevFrom = new Date(Date.now() - PREV_SNAPSHOT_MAX_HOURS * 60 * 60 * 1000);
    const prevTo = new Date(Date.now() - PREV_SNAPSHOT_MIN_HOURS * 60 * 60 * 1000);
    const prev = await this.prisma.goalAlignmentSnapshot.findFirst({
      where: {
        goalId,
        createdAt: { gte: prevFrom, lte: prevTo },
      },
      orderBy: { createdAt: 'desc' },
      select: { score: true },
    });

    const alertDeltaThreshold =
      (await this.cfg?.getDynamic<number>(
        'goals.alignmentAlertDelta',
        undefined,
        ALERT_DELTA_THRESHOLD,
      )) ?? ALERT_DELTA_THRESHOLD;
    const alertScoreThreshold =
      (await this.cfg?.getDynamic<number>(
        'goals.alignmentAlertScore',
        undefined,
        ALERT_SCORE_THRESHOLD,
      )) ?? ALERT_SCORE_THRESHOLD;

    const delta = prev ? parsed.score - prev.score : null;
    const alertPending =
      delta !== null && delta <= alertDeltaThreshold && parsed.score <= alertScoreThreshold;

    const snapshot = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goalAlignmentSnapshot.create({
        data: {
          tenantId,
          goalId,
          score: parsed.score,
          delta,
          explanation: parsed.explanation,
          signals: parsed.signals as unknown as Prisma.InputJsonValue,
          windowDays,
          themesCount,
          blocksCount: blocks.length,
          alertPending,
        },
        select: { id: true, createdAt: true },
      });
      await tx.goal.update({
        where: { id: goalId },
        data: {
          cachedAlignment: parsed.score,
          cachedAlignmentAt: created.createdAt,
          cachedAlignmentDelta: delta,
          cachedSnapshotId: created.id,
          cachedBlocksCount: blocks.length,
        },
      });
      return created;
    });

    void this.audit.log({
      action: 'goal.alignment.computed',
      resourceId: goalId,
      metadata: {
        tenantId,
        snapshotId: snapshot.id,
        score: parsed.score,
        delta,
        alertPending,
        themesCount,
        blocksCount: blocks.length,
        windowDays,
        manual: manual ?? false,
      },
    });

    this.logger.debug(
      {
        goalId,
        tenantId,
        score: parsed.score,
        delta,
        alertPending,
        blocks: blocks.length,
        themes: themesCount,
      },
      'strategic-alignment: snapshot записан',
    );
  }

  private async fetchBlocksForThemes(args: {
    tenantId: string;
    themeIds: string[];
    since: Date;
  }): Promise<
    Array<{
      signalType: string;
      criticalQuestion: string;
      trustedAnswer: string;
    }>
  > {
    if (args.themeIds.length === 0) return [];
    const maxBlocks =
      (await this.cfg?.getDynamic<number>('goals.alignmentMaxBlocks', undefined, MAX_BLOCKS)) ??
      MAX_BLOCKS;
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'canonical',
        createdAt: { gte: args.since },
        themes: { some: { themeId: { in: args.themeIds } } },
      },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: maxBlocks,
      select: {
        signalType: true,
        criticalQuestion: true,
        trustedAnswer: true,
      },
    });
    return rows;
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function decimalToNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  const obj = v as { toNumber?: () => number; toString?: () => string };
  if (typeof obj.toNumber === 'function') {
    try {
      return obj.toNumber();
    } catch {}
  }
  if (typeof obj.toString === 'function') {
    const n = Number.parseFloat(obj.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

type GoalAlignmentParsed = {
  score: number;
  explanation: string;
  signals: { pro: string[]; contra: string[] };
};

type ParseLlmResult =
  | { ok: true; data: GoalAlignmentParsed }
  | { ok: false; reason: string };

function parseLlmResponse(raw: string): ParseLlmResult {
  if (!raw || !raw.trim()) return { ok: false, reason: 'empty' };
  const parsedRaw = tryParseJson(raw);
  const validated = GoalAlignmentResponseSchema.safeParse(parsedRaw);
  if (!validated.success) {
    if (
      parsedRaw &&
      typeof parsedRaw === 'object' &&
      'raw' in parsedRaw &&
      Object.keys(parsedRaw as Record<string, unknown>).length === 1
    ) {
      return { ok: false, reason: 'invalid_json' };
    }
    return { ok: false, reason: 'schema_mismatch' };
  }
  return { ok: true, data: validated.data };
}
