import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { resolveAxisTenantTop } from '../../knowledge-core/services/tenant-top';
import {
  buildGoalsPulseFallbackMarkdown,
  buildGoalsPulseUserMessage,
  GOALS_PULSE_PROMPT_VERSION,
  GOALS_PULSE_SYSTEM_PROMPT,
  GOALS_PULSE_TASK_TYPE,
  parseGoalsPulseLlmResponse,
  type GoalsPulseAggregate,
  type GoalsPulseCounters,
  type GoalsPulseGoalLine,
} from '../prompts/goals-pulse-summarize.prompt';

/**
 * Goals OKR v2 (Фаза 4) — GoalsPulseService.
 *
 * Зеркало `DailyDigestService` с окном «прошедшая ISO-неделя в МСК».
 *
 * Двухстадийная сборка пульса:
 *   1. `aggregate` — счётчики целей по `progressStatus` + список активных
 *      целей со средним прогрессом KR (быстро, из БД).
 *   2. Один LLM-вызов `goals-pulse-summarize` — связный markdown + shortSummary.
 *
 * Идемпотентность — `@@unique([tenantId, isoWeek])`. Если за неделю пульс уже
 * сохранён — `getOrGenerate` возвращает существующий.
 *
 * При неудаче LLM сохраняем «сухой» вариант с `llmTaskRouteId=null` — это
 * позволяет различать «нормальный» пульс и fallback в админке.
 */
@Injectable()
export class GoalsPulseService {
  private readonly logger = new Logger(GoalsPulseService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────────── public API ─────────────────────────────

  /** Получить сохранённый пульс за неделю. null — ещё не сгенерирован. */
  async getStored(args: {
    tenantId: string;
    isoWeek: string;
  }): Promise<WeeklyGoalsPulseDigestDto | null> {
    const row = await this.prisma.weeklyGoalsPulseDigest.findUnique({
      where: {
        tenantId_isoWeek: { tenantId: args.tenantId, isoWeek: args.isoWeek },
      },
    });
    return row ? this.toDto(row) : null;
  }

  /**
   * Получить или сгенерировать (идемпотентность по `(tenantId, isoWeek)`).
   */
  async getOrGenerate(args: {
    tenantId: string;
    isoWeek: string;
    weekStart: Date;
    weekEnd: Date;
  }): Promise<WeeklyGoalsPulseDigestDto> {
    const existing = await this.getStored({
      tenantId: args.tenantId,
      isoWeek: args.isoWeek,
    });
    if (existing) return existing;
    return this.generate(args);
  }

  /**
   * Принудительная генерация (upsert по unique-ключу). Агрегирует → зовёт LLM
   * → сохраняет. При провале LLM — «сухой» fallback (llmTaskRouteId=null).
   */
  async generate(args: {
    tenantId: string;
    isoWeek: string;
    weekStart: Date;
    weekEnd: Date;
  }): Promise<WeeklyGoalsPulseDigestDto> {
    const tenantTop = resolveAxisTenantTop(args.tenantId);

    const aggregate = await this.aggregate(args);

    let bodyMarkdown: string;
    let shortSummary: string | null;
    let llmTaskRouteId: string | null = null;
    try {
      const result = await this.llm.call({
        taskType: GOALS_PULSE_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: GOALS_PULSE_SYSTEM_PROMPT,
        userMessage: buildGoalsPulseUserMessage(aggregate),
        maxTokens: 3_000,
        sourceRef: {
          type: 'goals-pulse',
          id: `${args.tenantId}:${args.isoWeek}`,
        },
      });
      const parsed = parseGoalsPulseLlmResponse(result.text);
      bodyMarkdown = parsed.bodyMarkdown;
      shortSummary = parsed.shortSummary;
      llmTaskRouteId = `${GOALS_PULSE_PROMPT_VERSION}+${result.modelUsed}`;
    } catch (err) {
      this.metrics.incGoalsPulseFailed({ tenantTop, reason: 'llm_failed' });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          isoWeek: args.isoWeek,
          err: err instanceof Error ? err.message : String(err),
        },
        'goals-pulse: LLM упал — сохраняю «сухой» вариант',
      );
      const fallback = buildGoalsPulseFallbackMarkdown(aggregate);
      bodyMarkdown = fallback.bodyMarkdown;
      shortSummary = fallback.shortSummary;
    }

    const row = await this.prisma.weeklyGoalsPulseDigest.upsert({
      where: {
        tenantId_isoWeek: { tenantId: args.tenantId, isoWeek: args.isoWeek },
      },
      create: {
        tenantId: args.tenantId,
        isoWeek: args.isoWeek,
        bodyMarkdown,
        shortSummary,
        metricsJson: aggregate.counters as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
      },
      update: {
        bodyMarkdown,
        shortSummary,
        metricsJson: aggregate.counters as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        // deliveredAt НЕ обнуляем при regenerate.
      },
    });

    this.metrics.incGoalsPulseGenerated({ tenantTop });
    return this.toDto(row);
  }

  /** Пометить пульс как доставленный. Best-effort. */
  async markDelivered(args: {
    tenantId: string;
    isoWeek: string;
  }): Promise<void> {
    await this.prisma.weeklyGoalsPulseDigest.updateMany({
      where: { tenantId: args.tenantId, isoWeek: args.isoWeek },
      data: { deliveredAt: new Date() },
    });
  }

  /**
   * Агрегация: счётчики целей по progressStatus (только active+живые) +
   * список целей со средним прогрессом KR. Выделена для тестов без LLM.
   *
   * `newThisWeek` — цели, появившиеся в окне недели (Goal.createdAt в [start,end)).
   */
  async aggregate(args: {
    tenantId: string;
    isoWeek: string;
    weekStart: Date;
    weekEnd: Date;
  }): Promise<GoalsPulseAggregate> {
    const goals = await this.prisma.goal.findMany({
      where: {
        tenantId: args.tenantId,
        promotionState: 'active',
        validUntil: null,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        progressStatus: true,
        createdAt: true,
        keyResults: {
          select: {
            startValue: true,
            targetValue: true,
            currentValue: true,
          },
        },
      },
    });

    const counters: GoalsPulseCounters = {
      achieved: 0,
      on_track: 0,
      at_risk: 0,
      stalled: 0,
      dropped: 0,
      total: goals.length,
      newThisWeek: 0,
    };

    const goalLines: GoalsPulseGoalLine[] = [];
    for (const g of goals) {
      switch (g.progressStatus) {
        case 'achieved':
          counters.achieved++;
          break;
        case 'on_track':
          counters.on_track++;
          break;
        case 'at_risk':
          counters.at_risk++;
          break;
        case 'stalled':
          counters.stalled++;
          break;
        case 'dropped':
          counters.dropped++;
          break;
        default:
          break;
      }

      const isNew =
        g.createdAt >= args.weekStart && g.createdAt < args.weekEnd;
      if (isNew) counters.newThisWeek++;

      goalLines.push({
        name: g.name,
        progressStatus: g.progressStatus,
        avgKrProgress: GoalsPulseService.avgKrProgress(g.keyResults),
        isNew,
      });
    }

    return {
      isoWeek: args.isoWeek,
      weekStart: GoalsPulseService.isoDate(args.weekStart),
      weekEnd: GoalsPulseService.isoDate(args.weekEnd),
      counters,
      goals: goalLines,
    };
  }

  // ─────────────────────────── helpers ────────────────────────────────

  /** Средний прогресс KR в % (0..100). null — если нет KR. */
  static avgKrProgress(
    krs: Array<{ startValue: unknown; targetValue: unknown; currentValue: unknown }>,
  ): number | null {
    if (krs.length === 0) return null;
    let sum = 0;
    for (const kr of krs) {
      sum += GoalsPulseService.progressPercent(
        GoalsPulseService.toNumber(kr.startValue),
        GoalsPulseService.toNumber(kr.targetValue),
        GoalsPulseService.toNumber(kr.currentValue),
      );
    }
    return sum / krs.length;
  }

  /** Прогресс KR в %: clamp 0..100, защита от деления на 0. */
  static progressPercent(start: number, target: number, current: number): number {
    const span = target - start;
    if (span === 0) return 0;
    const pct = ((current - start) / span) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }

  /** Безопасный Number из Decimal | number | string. */
  static toNumber(v: unknown): number {
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
      } catch {
        // fallback ниже
      }
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private static isoDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    isoWeek: string;
    bodyMarkdown: string;
    metricsJson: unknown;
    llmTaskRouteId: string | null;
    shortSummary: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
  }): WeeklyGoalsPulseDigestDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      isoWeek: row.isoWeek,
      bodyMarkdown: row.bodyMarkdown,
      shortSummary: row.shortSummary,
      metrics: (row.metricsJson as GoalsPulseCounters) ?? emptyCounters(),
      llmTaskRouteId: row.llmTaskRouteId,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ─────────────────────────── DTO ────────────────────────────────────

export interface WeeklyGoalsPulseDigestDto {
  id: string;
  tenantId: string;
  isoWeek: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: GoalsPulseCounters;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

function emptyCounters(): GoalsPulseCounters {
  return {
    achieved: 0,
    on_track: 0,
    at_risk: 0,
    stalled: 0,
    dropped: 0,
    total: 0,
    newThisWeek: 0,
  };
}
