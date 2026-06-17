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
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
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
    let parsed: {
      score: number;
      explanation: string;
      signals: { pro: string[]; contra: string[] };
    };
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
      parsed = parseLlmResponse(result.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { goalId, tenantId, err: message },
        'strategic-alignment: LLM/parse fail — snapshot не создаём',
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

    const delta = prev ? parsed.score - prev.score : null;
    const alertPending =
      delta !== null && delta <= ALERT_DELTA_THRESHOLD && parsed.score <= ALERT_SCORE_THRESHOLD;

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
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'canonical',
        createdAt: { gte: args.since },
        themes: { some: { themeId: { in: args.themeIds } } },
      },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: MAX_BLOCKS,
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

function parseLlmResponse(raw: string): {
  score: number;
  explanation: string;
  signals: { pro: string[]; contra: string[] };
} {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('LLM вернул пустой ответ');
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  const candidate =
    jsonStart >= 0 && jsonEnd > jsonStart ? trimmed.slice(jsonStart, jsonEnd + 1) : trimmed;
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `LLM вернул невалидный JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const validated = GoalAlignmentResponseSchema.safeParse(parsedRaw);
  if (!validated.success) {
    throw new Error(
      `LLM JSON не прошёл схему: ${validated.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; ')}`,
    );
  }
  return validated.data;
}
