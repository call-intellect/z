import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  WeeklyDigestMetricsDto,
  WeeklyDigestSourcesDto,
  WeeklyForecastItemDto,
  WeeklyKpiDeltaDto,
  WeeklyOperationsDigestDto,
  WeeklyTeamDynamicsRowDto,
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
   *
   * Pulse Wave 2 §2.2 — обогащает DTO runtime-секциями (kpiDeltas /
   * teamDynamics / forecast).
   */
  async getStored(args: {
    tenantId: string;
    weekStart: string;
  }): Promise<WeeklyOperationsDigestDto | null> {
    const row = await this.prisma.weeklyOperationsDigest.findUnique({
      where: { tenantId_weekStart: { tenantId: args.tenantId, weekStart: args.weekStart } },
    });
    if (!row) return null;
    return this.enrichDto(this.toDto(row));
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
      // TZ-1 Ф4.A — секция идей недели (опускается промптом, если пусто).
      ...(aggregates.metrics.topIdeas && aggregates.metrics.topIdeas.length > 0
        ? {
            topIdeas: aggregates.metrics.topIdeas.map((i) => ({
              statement: i.statement,
              status: i.status,
              supporterCount: i.supporterCount,
            })),
          }
        : {}),
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
    return this.enrichDto(this.toDto(row));
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
      ideasRaw,
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
      // TZ-1 Ф4.A — топ идей недели: активные (не rejected/archived),
      // обсуждавшиеся за окно недели, по weight + свежесть lastDiscussedAt.
      this.prisma.idea.findMany({
        where: {
          tenantId: args.tenantId,
          status: { notIn: ['rejected', 'archived'] },
          lastDiscussedAt: {
            gte: parseDateLocalToUtc(args.weekStart),
            lte: endOfDayUtc(parseDateLocalToUtc(args.weekEnd)),
          },
        },
        select: {
          id: true,
          statement: true,
          status: true,
          weight: true,
          supporterCount: true,
        },
        orderBy: [{ weight: 'desc' }, { lastDiscussedAt: 'desc' }],
        take: 5,
      }),
    ]);

    // TZ-1 Ф4.A — топ идей недели (опускается, если пусто).
    const topIdeas = ideasRaw.map((i) => ({
      ideaId: i.id,
      statement: (i.statement ?? '').slice(0, 400),
      status: i.status,
      weight: Number(i.weight),
      supporterCount: i.supporterCount,
    }));

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
      // TZ-1 Ф4.A — топ идей недели (пустой массив опускается на рендере).
      ...(topIdeas.length > 0 ? { topIdeas } : {}),
    };

    const sources: WeeklyDigestSourcesDto = {
      blockerCheckInIds,
      insightIds: insights.map((i) => i.id),
      goalIds: goals.map((g0) => g0.id),
      decisionIds: decisions.map((d) => d.id),
      ...(topIdeas.length > 0
        ? { ideaIds: topIdeas.map((i) => i.ideaId) }
        : {}),
    };

    return { metrics, sources };
  }

  /** Преобразование Prisma-row в DTO.
   *
   *  Pulse Wave 2 §2.2: 3 расширенных секции (kpiDeltas/teamDynamics/forecast)
   *  — НЕ хранятся в БД; здесь возвращаем пустые массивы. Реально они
   *  вычисляются `enrichDto()` через `computeRuntimeSections()`. Пустые
   *  дефолты гарантируют, что DTO type-корректен даже в ветке, где enrich
   *  не вызывается (например, в unit-тестах).
   */
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
      // Pulse Wave 2 §2.2 — runtime-секции, заполняются в enrichDto().
      kpiDeltas: [],
      teamDynamics: [],
      forecast: [],
    };
  }

  /**
   * Pulse Wave 2 §2.2 — обогащение DTO runtime-вычисленными секциями
   * (kpiDeltas / teamDynamics / forecast). НЕ-блокирующее на ошибки: если
   * запрос упал, возвращаем DTO с пустыми секциями (а не ломаем выдачу
   * всего отчёта).
   */
  private async enrichDto(
    dto: WeeklyOperationsDigestDto,
  ): Promise<WeeklyOperationsDigestDto> {
    try {
      const sections = await this.computeRuntimeSections({
        tenantId: dto.tenantId,
        weekStart: dto.weekStart,
        weekEnd: dto.weekEnd,
      });
      return { ...dto, ...sections };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: dto.tenantId,
          weekStart: dto.weekStart,
          err: err instanceof Error ? err.message : String(err),
        },
        'weekly-digest: computeRuntimeSections упал — возвращаю DTO без расширенных секций',
      );
      return dto;
    }
  }

  /**
   * Pulse Wave 2 §2.2 — собирает 3 секции:
   *   - kpiDeltas: 4 KPI текущей недели с дельтами к предыдущей неделе.
   *   - teamDynamics: команды, чьи sentiment / promises метрики выделились
   *     (изменение ≥10 в любую сторону), max 6.
   *   - forecast: линейная экстраполяция тренда на следующую неделю.
   *
   * НЕ персистится в БД. Считается прямыми Prisma-запросами (без инжекта
   * DashboardModule-сервисов — это создало бы circular dependency, т.к.
   * `DashboardModule` уже импортирует `OperationsModule` после Фазы 1.3).
   */
  private async computeRuntimeSections(args: {
    tenantId: string;
    weekStart: string;
    weekEnd: string;
  }): Promise<{
    kpiDeltas: WeeklyKpiDeltaDto[];
    teamDynamics: WeeklyTeamDynamicsRowDto[];
    forecast: WeeklyForecastItemDto[];
  }> {
    const curStart = args.weekStart;
    const curEnd = args.weekEnd;
    const prevStart = shiftDateStr(args.weekStart, -7);
    const prevEnd = shiftDateStr(args.weekEnd, -7);

    // Окно текущей недели в UTC (для запросов по DateTime-полям).
    const curStartUtc = parseDateLocalToUtc(curStart);
    const curEndUtc = endOfDayUtc(parseDateLocalToUtc(curEnd));
    const prevStartUtc = parseDateLocalToUtc(prevStart);
    const prevEndUtc = endOfDayUtc(parseDateLocalToUtc(prevEnd));

    // ── KPI #1-2: чек-ины (для sentiment-индекса и счётчика totalCheckIns).
    // ── KPI #3: commitments по commitmentDueDate в окне.
    // ── KPI #4: висящие решения (raisedCount>=2, status активные,
    //           createdAt старше weekEnd-7d на момент конца текущей недели
    //           и аналогично для предыдущей).
    const [
      curCheckIns,
      prevCheckIns,
      curCommitments,
      prevCommitments,
      curHanging,
      prevHanging,
    ] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: { in: ['green', 'yellow', 'red'] },
          dateLocal: { gte: curStart, lte: curEnd },
        },
        select: {
          id: true,
          sentiment: true,
          personId: true,
          person: { select: { primaryDepartmentId: true } },
        },
      }),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: { in: ['green', 'yellow', 'red'] },
          dateLocal: { gte: prevStart, lte: prevEnd },
        },
        select: {
          id: true,
          sentiment: true,
          personId: true,
          person: { select: { primaryDepartmentId: true } },
        },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentDueDate: { gte: curStartUtc, lte: curEndUtc },
        },
        select: {
          id: true,
          commitmentStatus: true,
          commitmentDueDate: true,
          commitmentRecipientPersonId: true,
          commitmentRecipient: {
            select: { id: true, primaryDepartmentId: true },
          },
        },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentDueDate: { gte: prevStartUtc, lte: prevEndUtc },
        },
        select: {
          id: true,
          commitmentStatus: true,
          commitmentDueDate: true,
          commitmentRecipientPersonId: true,
          commitmentRecipient: {
            select: { id: true, primaryDepartmentId: true },
          },
        },
      }),
      // Висящие решения на конец текущей недели: активные, raisedCount>=2,
      // createdAt < (curEnd - 7d) = старше 7 дней относительно конца недели.
      this.prisma.decision.count({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'proposed', 'approved'] },
          raisedCount: { gte: 2 },
          createdAt: { lt: addDays(curEndUtc, -7) },
        },
      }),
      this.prisma.decision.count({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'proposed', 'approved'] },
          raisedCount: { gte: 2 },
          createdAt: { lt: addDays(prevEndUtc, -7) },
        },
      }),
    ]);

    // ── KPI #1: индекс настроения = (green-red)/total * 100 (округлено).
    const curSent = computeSentimentIndex(curCheckIns);
    const prevSent = computeSentimentIndex(prevCheckIns);

    // ── KPI #2: надёжность обещаний = kept / (kept+broken+overdue) * 100.
    const curRel = computeReliabilityPercent(curCommitments);
    const prevRel = computeReliabilityPercent(prevCommitments);

    // ── KPI #3: висящие решения (Int).
    // ── KPI #4: чек-инов всего за неделю.
    const curTotal = curCheckIns.length;
    const prevTotal = prevCheckIns.length;

    const kpiDeltas: WeeklyKpiDeltaDto[] = [
      buildKpi('Индекс настроения', curSent, prevSent, 'pts'),
      buildKpi('Надёжность обещаний', curRel, prevRel, '%'),
      buildKpi('Висящие решения', curHanging, prevHanging, 'шт'),
      buildKpi('Чек-инов всего', curTotal, prevTotal, 'шт'),
    ];

    // ── teamDynamics: для каждого Department с persons>=3 считаем
    // sentiment + promises текущей и предыдущей недели.
    const teamDynamics = await this.computeTeamDynamics({
      tenantId: args.tenantId,
      curCheckIns,
      prevCheckIns,
      curCommitments,
      prevCommitments,
    });

    // ── forecast: Pulse Wave 4 §4.6 — приоритет ForecastSnapshot
    // (LLM-агент Forecaster, понедельник 04:00 UTC). Если за последние 14 дней
    // есть свежий snapshot — берём его. Иначе — линейная экстраполяция
    // (placeholder из Wave 2 §2.2).
    const forecast = await this.buildForecast({
      tenantId: args.tenantId,
      curSent,
      prevSent,
      curRel,
      prevRel,
      curHanging,
      prevHanging,
    });

    return { kpiDeltas, teamDynamics, forecast };
  }

  /**
   * Pulse Wave 4 §4.6 — построить forecast-секцию.
   *
   *   1. Если есть `ForecastSnapshot(scope='company')` за последние 14 дней —
   *      маппим `expectedShifts` обратно в 3-эл DTO (`sentiment` / `promises` /
   *      `hanging_decisions`). Confidence в DTO ограничен 'low'|'medium' —
   *      округляем: confidence>=0.5 → 'medium', иначе 'low'.
   *   2. Иначе — линейная экстраполяция (fallback из Wave 2 §2.2) или
   *      placeholder «Прогноз появится после первого прогона Forecaster».
   *
   * Не падает: если запрос упал — возвращаем линейный fallback (см. caller
   * `enrichDto`, который сам catch'ит).
   */
  private async buildForecast(args: {
    tenantId: string;
    curSent: number | null;
    prevSent: number | null;
    curRel: number | null;
    prevRel: number | null;
    curHanging: number;
    prevHanging: number;
  }): Promise<WeeklyForecastItemDto[]> {
    const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const snapshot = await this.prisma.forecastSnapshot.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'company',
        snapshotAt: { gte: since14d },
      },
      orderBy: { snapshotAt: 'desc' },
    });

    if (snapshot) {
      const mapped = this.mapForecastSnapshotToDto(snapshot.payloadJson);
      if (mapped !== null) return mapped;
      // Если payload битый — fallback на линейную экстраполяцию.
    }

    return [
      buildLinearForecast('sentiment', args.curSent, args.prevSent),
      buildLinearForecast('promises', args.curRel, args.prevRel),
      buildLinearForecast(
        'hanging_decisions',
        args.curHanging,
        args.prevHanging,
      ),
    ];
  }

  /**
   * Маппит `ForecastSnapshot.payloadJson` в массив `WeeklyForecastItemDto`.
   *
   * Источник — `expectedShifts: [{metric, direction, confidence}]` от
   * `forecast-weekly` LLM-агента. Для каждого из 3 целевых metric'ов
   * (`sentiment`/`promises`/`hanging_decisions`) пытаемся найти подходящий
   * shift; если не нашли — генерим нейтральный placeholder с confidence='low'.
   * Возвращает null, если payload не похож на нужный формат — caller сделает
   * fallback на линейную экстраполяцию.
   */
  private mapForecastSnapshotToDto(
    payload: unknown,
  ): WeeklyForecastItemDto[] | null {
    if (!payload || typeof payload !== 'object') return null;
    const obj = payload as Record<string, unknown>;
    const shifts = obj.expectedShifts;
    if (!Array.isArray(shifts)) return null;

    type Shift = {
      metric: string;
      direction: 'up' | 'flat' | 'down';
      confidence: number;
    };
    const byMetric = new Map<string, Shift>();
    for (const item of shifts) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const metric = r.metric;
      const direction = r.direction;
      const confidence = r.confidence;
      if (
        typeof metric === 'string' &&
        (direction === 'up' || direction === 'flat' || direction === 'down') &&
        typeof confidence === 'number'
      ) {
        byMetric.set(metric, { metric, direction, confidence });
      }
    }

    const result: WeeklyForecastItemDto[] = [];
    result.push(this.shiftToDto('sentiment', byMetric.get('sentiment_index')));
    result.push(
      this.shiftToDto('promises', byMetric.get('commitment_kept_ratio')),
    );
    result.push(
      this.shiftToDto('hanging_decisions', byMetric.get('hanging_decisions')),
    );
    return result;
  }

  private shiftToDto(
    metric: WeeklyForecastItemDto['metric'],
    shift:
      | { direction: 'up' | 'flat' | 'down'; confidence: number }
      | undefined,
  ): WeeklyForecastItemDto {
    if (!shift) {
      return {
        metric,
        projection: 'Forecaster не дал прогноза по этой метрике на следующую неделю.',
        confidence: 'low',
      };
    }
    const confidence: 'low' | 'medium' = shift.confidence >= 0.5 ? 'medium' : 'low';
    const direction = shift.direction;
    if (metric === 'sentiment') {
      if (direction === 'up')
        return {
          metric,
          projection: 'Forecaster: настроение продолжит расти на следующей неделе.',
          confidence,
        };
      if (direction === 'down')
        return {
          metric,
          projection: 'Forecaster: ожидается просадка настроения.',
          confidence,
        };
      return {
        metric,
        projection: 'Forecaster: настроение стабильно — особых сдвигов не ожидается.',
        confidence,
      };
    }
    if (metric === 'promises') {
      if (direction === 'up')
        return {
          metric,
          projection: 'Forecaster: надёжность обещаний продолжит расти.',
          confidence,
        };
      if (direction === 'down')
        return {
          metric,
          projection: 'Forecaster: ожидается просадка надёжности обещаний.',
          confidence,
        };
      return {
        metric,
        projection: 'Forecaster: надёжность обещаний стабильна.',
        confidence,
      };
    }
    // hanging_decisions
    if (direction === 'up')
      return {
        metric,
        projection: 'Forecaster: очередь висящих решений вырастет.',
        confidence,
      };
    if (direction === 'down')
      return {
        metric,
        projection: 'Forecaster: очередь висящих решений сократится.',
        confidence,
      };
    return {
      metric,
      projection: 'Forecaster: очередь висящих решений стабильна.',
      confidence,
    };
  }

  /**
   * Pulse Wave 2 §2.2 — динамика команд по sentiment / promises.
   *
   * Для каждого Department:
   *   - sentiment-delta = индекс_текущая - индекс_предыдущая (по чек-инам
   *     сотрудников этого отдела);
   *   - promises-delta = reliability_текущая - reliability_предыдущая
   *     (по обещаниям, адресованным сотрудникам отдела).
   *
   * Команды, у которых в обеих неделях <3 человек писали чек-ин/получали
   * commitment, отбрасываем (статистически слабый сигнал).
   *
   * Возвращаем top-2 по росту и top-2 по падению для каждой метрики (макс 6,
   * берём только delta ≥ ±10).
   */
  private async computeTeamDynamics(args: {
    tenantId: string;
    curCheckIns: Array<{
      sentiment: string | null;
      personId: string;
      person: { primaryDepartmentId: string | null } | null;
    }>;
    prevCheckIns: Array<{
      sentiment: string | null;
      personId: string;
      person: { primaryDepartmentId: string | null } | null;
    }>;
    curCommitments: Array<{
      commitmentStatus: string | null;
      commitmentDueDate: Date | null;
      commitmentRecipient: { primaryDepartmentId: string | null } | null;
    }>;
    prevCommitments: Array<{
      commitmentStatus: string | null;
      commitmentDueDate: Date | null;
      commitmentRecipient: { primaryDepartmentId: string | null } | null;
    }>;
  }): Promise<WeeklyTeamDynamicsRowDto[]> {
    // Соберём множество всех потенциальных departmentId.
    const depIds = new Set<string>();
    for (const c of args.curCheckIns) {
      if (c.person?.primaryDepartmentId) depIds.add(c.person.primaryDepartmentId);
    }
    for (const c of args.prevCheckIns) {
      if (c.person?.primaryDepartmentId) depIds.add(c.person.primaryDepartmentId);
    }
    for (const c of args.curCommitments) {
      if (c.commitmentRecipient?.primaryDepartmentId)
        depIds.add(c.commitmentRecipient.primaryDepartmentId);
    }
    for (const c of args.prevCommitments) {
      if (c.commitmentRecipient?.primaryDepartmentId)
        depIds.add(c.commitmentRecipient.primaryDepartmentId);
    }

    if (depIds.size === 0) return [];

    const departments = await this.prisma.department.findMany({
      where: { id: { in: Array.from(depIds) }, tenantId: args.tenantId },
      select: { id: true, name: true },
    });
    const depNameById = new Map(departments.map((d) => [d.id, d.name]));

    // group-функции по departmentId.
    const sentByDep = (checkIns: typeof args.curCheckIns) => {
      const map = new Map<string, { g: number; y: number; r: number; total: number }>();
      for (const c of checkIns) {
        const dep = c.person?.primaryDepartmentId;
        if (!dep) continue;
        const v = map.get(dep) ?? { g: 0, y: 0, r: 0, total: 0 };
        if (c.sentiment === 'green') v.g++;
        else if (c.sentiment === 'yellow') v.y++;
        else if (c.sentiment === 'red') v.r++;
        v.total++;
        map.set(dep, v);
      }
      return map;
    };

    const relByDep = (commits: typeof args.curCommitments) => {
      const map = new Map<string, { kept: number; broken: number; overdue: number; total: number }>();
      const now = new Date();
      for (const c of commits) {
        const dep = c.commitmentRecipient?.primaryDepartmentId;
        if (!dep) continue;
        const v = map.get(dep) ?? { kept: 0, broken: 0, overdue: 0, total: 0 };
        const status = c.commitmentStatus;
        if (status === 'fulfilled') {
          v.kept++;
          v.total++;
        } else if (status === 'missed') {
          v.broken++;
          v.total++;
        } else if (
          (status === 'open' || status === 'asked') &&
          c.commitmentDueDate &&
          c.commitmentDueDate < now
        ) {
          v.overdue++;
          v.total++;
        }
        map.set(dep, v);
      }
      return map;
    };

    const sentCur = sentByDep(args.curCheckIns);
    const sentPrev = sentByDep(args.prevCheckIns);
    const relCur = relByDep(args.curCommitments);
    const relPrev = relByDep(args.prevCommitments);

    const SENTIMENT_THRESHOLD = 10; // pts
    const PROMISES_THRESHOLD = 10; // p.p.
    const MIN_TEAM_SIZE = 3;

    // Кандидаты (depId, signal, delta, detail).
    type Candidate = {
      depId: string;
      depName: string;
      signal: WeeklyTeamDynamicsRowDto['signal'];
      delta: number;
      detail: string;
    };
    const candidates: Candidate[] = [];

    for (const depId of depIds) {
      const name = depNameById.get(depId) ?? depId;

      // Sentiment.
      const sc = sentCur.get(depId);
      const sp = sentPrev.get(depId);
      if (sc && sp && sc.total >= MIN_TEAM_SIZE && sp.total >= MIN_TEAM_SIZE) {
        const curIdx = Math.round(((sc.g - sc.r) / sc.total) * 100);
        const prevIdx = Math.round(((sp.g - sp.r) / sp.total) * 100);
        const delta = curIdx - prevIdx;
        if (delta >= SENTIMENT_THRESHOLD) {
          candidates.push({
            depId,
            depName: name,
            signal: 'sentiment_improved',
            delta,
            detail: `Настроение +${delta} балл. (${prevIdx} → ${curIdx}); ${sc.total} чек-инов`,
          });
        } else if (delta <= -SENTIMENT_THRESHOLD) {
          candidates.push({
            depId,
            depName: name,
            signal: 'sentiment_dropped',
            delta,
            detail: `Настроение ${delta} балл. (${prevIdx} → ${curIdx}); ${sc.total} чек-инов`,
          });
        }
      }

      // Promises.
      const rc = relCur.get(depId);
      const rp = relPrev.get(depId);
      if (rc && rp && rc.total >= MIN_TEAM_SIZE && rp.total >= MIN_TEAM_SIZE) {
        const curPct = Math.round((rc.kept / Math.max(1, rc.total)) * 100);
        const prevPct = Math.round((rp.kept / Math.max(1, rp.total)) * 100);
        const delta = curPct - prevPct;
        if (delta >= PROMISES_THRESHOLD) {
          candidates.push({
            depId,
            depName: name,
            signal: 'promises_improved',
            delta,
            detail: `Обещания +${delta} п.п. (${prevPct}% → ${curPct}%); ${rc.total} обещаний`,
          });
        } else if (delta <= -PROMISES_THRESHOLD) {
          candidates.push({
            depId,
            depName: name,
            signal: 'promises_dropped',
            delta,
            detail: `Обещания ${delta} п.п. (${prevPct}% → ${curPct}%); ${rc.total} обещаний`,
          });
        }
      }
    }

    // Top-2 улучшившихся / top-2 ухудшившихся для каждой метрики, max 6.
    const sentUp = candidates
      .filter((c) => c.signal === 'sentiment_improved')
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 2);
    const sentDown = candidates
      .filter((c) => c.signal === 'sentiment_dropped')
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 2);
    const promUp = candidates
      .filter((c) => c.signal === 'promises_improved')
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 1);
    const promDown = candidates
      .filter((c) => c.signal === 'promises_dropped')
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 1);

    return [...sentUp, ...sentDown, ...promUp, ...promDown]
      .slice(0, 6)
      .map((c) => ({
        departmentId: c.depId,
        departmentName: c.depName,
        signal: c.signal,
        detail: c.detail,
      }));
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

/** Сдвиг даты-строки YYYY-MM-DD на ±N дней; возвращает YYYY-MM-DD. */
function shiftDateStr(dateLocal: string, days: number): string {
  const d = parseDateLocalToUtc(dateLocal);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Индекс настроения в pts (-100..+100): (green - red) / total * 100.
 * `null` если total=0 (нет чек-инов — не из чего считать).
 */
function computeSentimentIndex(
  checkIns: Array<{ sentiment: string | null }>,
): number | null {
  let g = 0;
  let r = 0;
  let total = 0;
  for (const c of checkIns) {
    if (c.sentiment === 'green') {
      g++;
      total++;
    } else if (c.sentiment === 'yellow') {
      total++;
    } else if (c.sentiment === 'red') {
      r++;
      total++;
    }
  }
  if (total === 0) return null;
  return Math.round(((g - r) / total) * 100);
}

/**
 * Reliability в % (0..100): kept / (kept+broken+overdue) * 100.
 * `null` если знаменатель=0.
 */
function computeReliabilityPercent(
  commits: Array<{
    commitmentStatus: string | null;
    commitmentDueDate: Date | null;
  }>,
): number | null {
  const now = new Date();
  let kept = 0;
  let broken = 0;
  let overdue = 0;
  for (const c of commits) {
    const s = c.commitmentStatus;
    if (s === 'fulfilled') kept++;
    else if (s === 'missed') broken++;
    else if (
      (s === 'open' || s === 'asked') &&
      c.commitmentDueDate &&
      c.commitmentDueDate < now
    )
      overdue++;
  }
  const denom = kept + broken + overdue;
  if (denom === 0) return null;
  return Math.round((kept / denom) * 100);
}

/** Хелпер: собрать запись KPI с дельтой. */
function buildKpi(
  label: string,
  current: number | null,
  previous: number | null,
  unit: WeeklyKpiDeltaDto['unit'],
): WeeklyKpiDeltaDto {
  const curN = current ?? 0;
  const delta = current === null || previous === null ? null : current - previous;
  return {
    label,
    current: curN,
    previous,
    delta,
    unit,
  };
}

/**
 * Прогноз по KPI: линейная экстраполяция на следующую неделю.
 * Confidence='medium' если |delta| >= 10, иначе 'low'.
 *
 * Используется как fallback, если `ForecastSnapshot` (Pulse Wave 4 §4.6)
 * ещё не сгенерирован для этой Org. После первого прогона
 * `ForecasterCron` приоритет переключается на LLM-агента.
 */
function buildLinearForecast(
  metric: WeeklyForecastItemDto['metric'],
  current: number | null,
  previous: number | null,
): WeeklyForecastItemDto {
  const delta =
    current !== null && previous !== null ? current - previous : null;
  const confidence: 'low' | 'medium' =
    delta !== null && Math.abs(delta) >= 10 ? 'medium' : 'low';
  const projected =
    delta !== null && current !== null ? current + delta : current;

  if (metric === 'sentiment') {
    if (current === null) {
      return {
        metric,
        projection: 'Недостаточно данных для прогноза настроения.',
        confidence: 'low',
      };
    }
    if (delta === null || delta === 0) {
      return {
        metric,
        projection: 'Настроение стабильно — особых сдвигов не ожидается.',
        confidence,
      };
    }
    if (delta > 0) {
      return {
        metric,
        projection: `Настроение продолжит расти, ожидаемое значение ~${projected} балл. к концу недели.`,
        confidence,
      };
    }
    return {
      metric,
      projection: `При сохранении тренда настроение может упасть до ~${projected} балл.`,
      confidence,
    };
  }

  if (metric === 'promises') {
    if (current === null) {
      return {
        metric,
        projection: 'Недостаточно данных для прогноза по обещаниям.',
        confidence: 'low',
      };
    }
    if (delta === null || delta === 0) {
      return {
        metric,
        projection: 'Надёжность обещаний стабильна — особых сдвигов не ожидается.',
        confidence,
      };
    }
    if (delta > 0) {
      return {
        metric,
        projection: `Надёжность обещаний продолжит расти, ожидаемое значение ~${projected}% к концу недели.`,
        confidence,
      };
    }
    return {
      metric,
      projection: `При сохранении тренда надёжность обещаний может упасть до ~${projected}%.`,
      confidence,
    };
  }

  // hanging_decisions
  if (current === null) {
    return {
      metric,
      projection: 'Недостаточно данных для прогноза по висящим решениям.',
      confidence: 'low',
    };
  }
  if (delta === null || delta === 0) {
    return {
      metric,
      projection: 'Очередь висящих решений стабильна — особых сдвигов не ожидается.',
      confidence,
    };
  }
  if (delta > 0) {
    return {
      metric,
      projection: `При сохранении тренда висящих решений станет ~${Math.max(0, projected ?? 0)} к концу недели.`,
      confidence,
    };
  }
  return {
    metric,
    projection: `Очередь висящих решений сокращается, ожидаемое значение ~${Math.max(0, projected ?? 0)} к концу недели.`,
    confidence,
  };
}
