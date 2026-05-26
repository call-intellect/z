import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  WeeklyDigestMetricsDto,
  WeeklyDigestSourcesDto,
  WeeklyOperationsDigestDto,
} from '../dto/weekly-digest.dto';
import {
  WEEKLY_DIGEST_PROMPT_VERSION,
  WEEKLY_DIGEST_SYSTEM_PROMPT,
  buildFallbackDigestMarkdown,
  buildWeeklyDigestUserMessage,
  type WeeklyDigestAggregates,
} from '../prompts/weekly-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8.1 — WeeklyDigestService.
 *
 * Источник: plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md §5, §8.
 *
 * Двухстадийная сборка дайджеста:
 *   1. Агрегация из БД (быстро): чек-ины (green/yellow/red), повторяющиеся
 *      блокеры, инсайты, цели, висящие решения.
 *   2. Один LLM-вызов `operations-weekly-digest` — связный текст.
 *
 * Идемпотентность — `@@unique([tenantId, weekStart])`. Если за неделю
 * дайджест уже сохранён — `getOrGenerate` возвращает существующий.
 *
 * При неудаче LLM сохраняем «сухой» вариант (структура без связного текста)
 * с `llmTaskRouteId=null` — это позволяет различать «нормальный» дайджест
 * и fallback в админке.
 */
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Получить сохранённый дайджест за неделю. Возвращает `null`, если ещё
   * не сгенерирован.
   */
  async getStored(args: {
    tenantId: string;
    weekStart: string;
  }): Promise<WeeklyOperationsDigestDto | null> {
    const row = await this.prisma.weeklyOperationsDigest.findUnique({
      where: { tenantId_weekStart: { tenantId: args.tenantId, weekStart: args.weekStart } },
    });
    return row ? this.toDto(row) : null;
  }

  /**
   * Получить или сгенерировать. Если дайджест уже есть — возвращает его
   * (идемпотентность по `(tenantId, weekStart)`).
   */
  async getOrGenerate(args: {
    tenantId: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<WeeklyOperationsDigestDto> {
    const existing = await this.getStored({
      tenantId: args.tenantId,
      weekStart: args.weekStart,
    });
    if (existing) return existing;
    return this.generate(args);
  }

  /**
   * Принудительная генерация. Если дайджест уже есть — перезаписывает
   * (используется admin-эндпоинтом POST /generate для отладки).
   */
  async generate(args: {
    tenantId: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<WeeklyOperationsDigestDto> {
    const tenantTop = resolveOperationsTenantTop(args.tenantId);
    let aggregates: { metrics: WeeklyDigestMetricsDto; sources: WeeklyDigestSourcesDto };
    try {
      aggregates = await this.aggregate({
        tenantId: args.tenantId,
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
      });
    } catch (err) {
      this.metrics.incCooWeeklyDigestFailed({
        tenantTop,
        reason: 'aggregation_failed',
      });
      this.logger.error(
        {
          tenantId: args.tenantId,
          weekStart: args.weekStart,
          err: err instanceof Error ? err.message : String(err),
        },
        'weekly-digest: ошибка агрегации источников',
      );
      throw err;
    }

    const promptInput: WeeklyDigestAggregates = {
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      totalCheckIns: aggregates.metrics.totalCheckIns,
      greenShare: aggregates.metrics.greenShare,
      yellowShare: aggregates.metrics.yellowShare,
      redShare: aggregates.metrics.redShare,
      topBlockers: aggregates.metrics.topBlockers,
      topInsights: aggregates.metrics.topInsights.map((i) => ({
        statement: i.statement,
        kind: i.kind,
        dynamicLabel: i.dynamicLabel,
      })),
      goals: aggregates.metrics.goals,
      hangingDecisions: aggregates.metrics.hangingDecisions.map((d) => ({
        statement: d.statement,
        ageDays: d.ageDays,
      })),
    };

    let bodyMarkdown: string;
    let llmTaskRouteId: string | null = null;
    try {
      const result = await this.llm.call({
        taskType: 'operations-weekly-digest',
        tenantId: args.tenantId,
        systemPrompt: WEEKLY_DIGEST_SYSTEM_PROMPT,
        userMessage: buildWeeklyDigestUserMessage(promptInput),
        // ТЗ 2026-05-25 LLM-architecture §6.6 — 1500 → 4000. Текст ~250-600
        // слов (≈800-2000 токенов output) + thinking-токены DeepSeek-Pro.
        maxTokens: 4_000,
        sourceRef: { type: 'weekly-digest', id: `${args.tenantId}:${args.weekStart}` },
      });
      bodyMarkdown = result.text.trim();
      llmTaskRouteId = `${WEEKLY_DIGEST_PROMPT_VERSION}+${result.modelUsed}`;
    } catch (err) {
      this.metrics.incCooWeeklyDigestFailed({
        tenantTop,
        reason: 'llm_failed',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          weekStart: args.weekStart,
          err: err instanceof Error ? err.message : String(err),
        },
        'weekly-digest: LLM упал — сохраняю «сухой» вариант',
      );
      bodyMarkdown = buildFallbackDigestMarkdown(promptInput);
    }

    // Upsert идемпотентен по `(tenantId, weekStart)`.
    const row = await this.prisma.weeklyOperationsDigest.upsert({
      where: {
        tenantId_weekStart: {
          tenantId: args.tenantId,
          weekStart: args.weekStart,
        },
      },
      create: {
        tenantId: args.tenantId,
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
        bodyMarkdown,
        metricsJson: aggregates.metrics as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
      },
      update: {
        weekEnd: args.weekEnd,
        bodyMarkdown,
        metricsJson: aggregates.metrics as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
      },
    });

    this.metrics.incCooWeeklyDigestGenerated({ tenantTop });
    return this.toDto(row);
  }

  /**
   * Агрегация источников: чек-ины, повторяющиеся блокеры, инсайты, цели,
   * висящие решения. Выделена для тестирования без LLM.
   */
  async aggregate(args: {
    tenantId: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<{ metrics: WeeklyDigestMetricsDto; sources: WeeklyDigestSourcesDto }> {
    const [
      checkIns,
      _prevCheckIns,
      blockerCheckIns,
      insights,
      goals,
      decisions,
      goalsPrev,
    ] = await Promise.all([
      // Чек-ины текущей недели — для долей green/yellow/red.
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: { in: ['green', 'yellow', 'red'] },
          dateLocal: { gte: args.weekStart, lte: args.weekEnd },
        },
        select: { sentiment: true, id: true },
      }),
      // Чек-ины предыдущей недели — для дельты целей (используется
      // отдельно — здесь только для подсчёта delta при необходимости).
      Promise.resolve([] as Array<{ id: string }>),
      // Чек-ины с блокерами — для топ-блокеров недели.
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          dateLocal: { gte: args.weekStart, lte: args.weekEnd },
          blockersJson: { not: Prisma.JsonNull },
        },
        select: { id: true, blockersJson: true },
      }),
      // Инсайты (β-4 Insights Radar) — топ-3 по динамике за последние 7д.
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          status: 'active',
          lastObservedAt: {
            gte: parseDateLocalToUtc(args.weekStart),
            lte: endOfDayUtc(parseDateLocalToUtc(args.weekEnd)),
          },
        },
        select: {
          id: true,
          statement: true,
          kind: true,
          dynamicLabel: true,
          dynamicScore: true,
        },
        orderBy: { dynamicScore: 'desc' },
        take: 3,
      }),
      // Цели — текущая неделя (по updatedAt).
      this.prisma.goal.findMany({
        where: {
          tenantId: args.tenantId,
          updatedAt: {
            gte: parseDateLocalToUtc(args.weekStart),
            lte: endOfDayUtc(parseDateLocalToUtc(args.weekEnd)),
          },
        },
        select: { id: true, status: true, archivedAt: true },
      }),
      // Висящие решения старше 7 дней без actualOutcomes.
      this.prisma.decision.findMany({
        where: {
          tenantId: args.tenantId,
          status: { in: ['approved', 'proposed', 'active', 'implemented'] },
          actualOutcomes: null,
          decidedAt: { lt: addDays(parseDateLocalToUtc(args.weekStart), -7) },
        },
        select: { id: true, statement: true, text: true, decidedAt: true },
        orderBy: { decidedAt: 'asc' },
        take: 5,
      }),
      // Цели — предыдущая неделя (для дельты).
      this.prisma.goal.findMany({
        where: {
          tenantId: args.tenantId,
          updatedAt: {
            gte: addDays(parseDateLocalToUtc(args.weekStart), -7),
            lt: parseDateLocalToUtc(args.weekStart),
          },
        },
        select: { id: true, status: true },
      }),
    ]);

    // Доли по чек-инам.
    let g = 0;
    let y = 0;
    let r = 0;
    for (const row of checkIns) {
      if (row.sentiment === 'green') g++;
      else if (row.sentiment === 'yellow') y++;
      else if (row.sentiment === 'red') r++;
    }
    const total = g + y + r;

    // Топ-5 повторяющихся блокеров — группируем по нормализованному
    // первому слову + первым 40 символам, чтобы устранить пробелы и
    // регистр. Это не «семантическая» дедупликация, но даёт разумный топ.
    const blockerKey = new Map<string, { text: string; count: number; checkInIds: Set<string> }>();
    for (const row of blockerCheckIns) {
      if (!Array.isArray(row.blockersJson)) continue;
      for (const b of row.blockersJson as Array<{ text?: string }>) {
        if (!b || typeof b.text !== 'string') continue;
        const key = b.text.trim().toLowerCase().slice(0, 40);
        if (!key) continue;
        const existing = blockerKey.get(key);
        if (existing) {
          existing.count++;
          existing.checkInIds.add(row.id);
        } else {
          blockerKey.set(key, {
            text: b.text.trim().slice(0, 400),
            count: 1,
            checkInIds: new Set([row.id]),
          });
        }
      }
    }
    const topBlockers = Array.from(blockerKey.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((b) => ({ text: b.text, count: b.count }));
    const blockerCheckInIds = Array.from(
      new Set(
        Array.from(blockerKey.values())
          .slice(0, 5)
          .flatMap((b) => Array.from(b.checkInIds)),
      ),
    );

    // Цели — achieved (≈completed) / abandoned (≈failed) / active (inProgress)
    // + дельта к прошлой неделе. NB: enum GoalStatus = active|paused|achieved|abandoned.
    const completedNow = goals.filter((g0) => g0.status === 'achieved').length;
    const failedNow = goals.filter((g0) => g0.status === 'abandoned').length;
    const inProgressNow = goals.filter(
      (g0) => g0.status === 'active' && g0.archivedAt === null,
    ).length;
    const completedPrev = goalsPrev.filter(
      (g0) => g0.status === 'achieved',
    ).length;
    const failedPrev = goalsPrev.filter((g0) => g0.status === 'abandoned').length;

    // Висящие решения — собираем provenance + age.
    const now = new Date();
    const hangingDecisions = decisions.map((d) => {
      const ageDays = d.decidedAt
        ? Math.floor((now.getTime() - d.decidedAt.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      const statement = (d.statement ?? d.text ?? '').slice(0, 400);
      return {
        decisionId: d.id,
        statement,
        ageDays,
      };
    });

    const metrics: WeeklyDigestMetricsDto = {
      totalCheckIns: total,
      greenShare: total > 0 ? g / total : 0,
      yellowShare: total > 0 ? y / total : 0,
      redShare: total > 0 ? r / total : 0,
      topBlockers,
      topInsights: insights.map((i) => ({
        insightId: i.id,
        statement: (i.statement ?? '').slice(0, 400),
        kind: i.kind,
        dynamicLabel: i.dynamicLabel,
      })),
      goals: {
        completed: completedNow,
        failed: failedNow,
        inProgress: inProgressNow,
        completedDelta: completedNow - completedPrev,
        failedDelta: failedNow - failedPrev,
      },
      hangingDecisions,
    };

    const sources: WeeklyDigestSourcesDto = {
      blockerCheckInIds,
      insightIds: insights.map((i) => i.id),
      goalIds: goals.map((g0) => g0.id),
      decisionIds: decisions.map((d) => d.id),
    };

    return { metrics, sources };
  }

  /** Преобразование Prisma-row в DTO. */
  private toDto(row: {
    id: string;
    tenantId: string;
    weekStart: string;
    weekEnd: string;
    bodyMarkdown: string;
    metricsJson: unknown;
    sourcesJson: unknown;
    llmTaskRouteId: string | null;
    createdAt: Date;
  }): WeeklyOperationsDigestDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      bodyMarkdown: row.bodyMarkdown,
      metrics: (row.metricsJson as WeeklyDigestMetricsDto) ?? emptyMetrics(),
      sources: (row.sourcesJson as WeeklyDigestSourcesDto) ?? emptySources(),
      llmTaskRouteId: row.llmTaskRouteId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function emptyMetrics(): WeeklyDigestMetricsDto {
  return {
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    topBlockers: [],
    topInsights: [],
    goals: {
      completed: 0,
      failed: 0,
      inProgress: 0,
      completedDelta: 0,
      failedDelta: 0,
    },
    hangingDecisions: [],
  };
}

function emptySources(): WeeklyDigestSourcesDto {
  return { blockerCheckInIds: [], insightIds: [], goalIds: [], decisionIds: [] };
}

function parseDateLocalToUtc(dateLocal: string): Date {
  // dateLocal = YYYY-MM-DD; конвертация в UTC-начало дня.
  return new Date(`${dateLocal}T00:00:00.000Z`);
}

function endOfDayUtc(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + days);
  return c;
}
