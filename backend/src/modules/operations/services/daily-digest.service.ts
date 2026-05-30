import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  DailyDigestMetricsDto,
  DailyDigestSourcesDto,
  DailyDigestAggregates,
  DailyOperationsDigestDto,
  DailyDigestEventDto,
  DailyDigestUrgentItemDto,
  DailyDigestPersonShinedDto,
  DailyDigestPersonStruggledDto,
} from '../dto/daily-digest.dto';
import {
  DAILY_DIGEST_PROMPT_VERSION,
  DAILY_DIGEST_SYSTEM_PROMPT,
  DAILY_DIGEST_TASK_TYPE,
  buildDailyDigestUserMessage,
  buildFallbackDigestMarkdown,
  parseDailyDigestLlmResponse,
} from '../prompts/daily-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8.3 — DailyDigestService.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.3, §1.6.
 *
 * Зеркало `WeeklyDigestService` с окном «вчерашние сутки в МСК».
 *
 * Двухстадийная сборка дайджеста:
 *   1. Агрегация из БД (быстро): чек-ины (green/yellow/red + красные точки),
 *      новые блокеры за день, просроченные обещания, цели (статус изменился),
 *      новые high-severity инсайты, решения.
 *   2. Один LLM-вызов `operations-daily-digest` — связный текст + shortSummary.
 *
 * Идемпотентность — `@@unique([tenantId, dateLocal])`. Если за день
 * дайджест уже сохранён — `getOrGenerate` возвращает существующий.
 *
 * При неудаче LLM сохраняем «сухой» вариант (структура без связного текста)
 * с `llmTaskRouteId=null` — это позволяет различать «нормальный» дайджест
 * и fallback в админке.
 */
@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Получить сохранённый дайджест за дату. Возвращает `null`, если ещё
   * не сгенерирован.
   */
  async getStored(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DailyOperationsDigestDto | null> {
    const row = await this.prisma.dailyOperationsDigest.findUnique({
      where: {
        tenantId_dateLocal: {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
        },
      },
    });
    if (!row) return null;
    return this.enrichDto(this.toDto(row));
  }

  /**
   * Последний сохранённый дайджест. Для блока «Вчерашний отчёт» на главной.
   */
  async getLatest(args: {
    tenantId: string;
  }): Promise<DailyOperationsDigestDto | null> {
    const row = await this.prisma.dailyOperationsDigest.findFirst({
      where: { tenantId: args.tenantId },
      orderBy: { dateLocal: 'desc' },
    });
    if (!row) return null;
    return this.enrichDto(this.toDto(row));
  }

  /**
   * Получить или сгенерировать. Если дайджест уже есть — возвращает его
   * (идемпотентность по `(tenantId, dateLocal)`).
   */
  async getOrGenerate(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DailyOperationsDigestDto> {
    const existing = await this.getStored(args);
    if (existing) return existing;
    return this.generate(args);
  }

  /**
   * Принудительная генерация. Если дайджест уже есть — перезаписывает
   * (используется admin-эндпоинтом POST /generate для отладки).
   */
  async generate(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DailyOperationsDigestDto> {
    const tenantTop = resolveOperationsTenantTop(args.tenantId);
    let aggregates: { metrics: DailyDigestMetricsDto; sources: DailyDigestSourcesDto };
    try {
      aggregates = await this.aggregate({
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
      });
    } catch (err) {
      this.metrics.incCooDailyDigestFailed({
        tenantTop,
        reason: 'aggregation_failed',
      });
      this.logger.error(
        {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: ошибка агрегации источников',
      );
      throw err;
    }

    const promptInput: DailyDigestAggregates = {
      dateLocal: args.dateLocal,
      totalCheckIns: aggregates.metrics.totalCheckIns,
      greenShare: aggregates.metrics.greenShare,
      yellowShare: aggregates.metrics.yellowShare,
      redShare: aggregates.metrics.redShare,
      topRedCheckIns: aggregates.metrics.topRedCheckIns.map((r) => ({
        personName: r.personName,
        excerpt: r.excerpt,
      })),
      newBlockers: aggregates.metrics.newBlockers.map((b) => ({
        name: b.name,
        confidence: b.confidence,
      })),
      overdueCommitments: aggregates.metrics.overdueCommitments.map((c) => ({
        name: c.name,
        dueDate: c.dueDate,
      })),
      goals: {
        completed: aggregates.metrics.goals.completed,
        failed: aggregates.metrics.goals.failed,
        activated: aggregates.metrics.goals.activated,
      },
      newHighInsights: aggregates.metrics.newHighInsights.map((i) => ({
        statement: i.statement,
        kind: i.kind,
        causeCategory: i.causeCategory,
      })),
      decisions: aggregates.metrics.decisions.map((d) => ({
        statement: d.statement,
        status: d.status,
      })),
    };

    let bodyMarkdown: string;
    let shortSummary: string | null;
    let llmTaskRouteId: string | null = null;
    try {
      const result = await this.llm.call({
        taskType: DAILY_DIGEST_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: DAILY_DIGEST_SYSTEM_PROMPT,
        userMessage: buildDailyDigestUserMessage(promptInput),
        // ТЗ 2026-05-25 LLM-architecture §6.6 — 1500 → 4000. Текст 200-450 слов
        // + shortSummary + thinking-токены DeepSeek-Pro.
        maxTokens: 4_000,
        sourceRef: { type: 'daily-digest', id: `${args.tenantId}:${args.dateLocal}` },
      });
      const parsed = parseDailyDigestLlmResponse(result.text);
      bodyMarkdown = parsed.bodyMarkdown;
      shortSummary = parsed.shortSummary;
      llmTaskRouteId = `${DAILY_DIGEST_PROMPT_VERSION}+${result.modelUsed}`;
    } catch (err) {
      this.metrics.incCooDailyDigestFailed({
        tenantTop,
        reason: 'llm_failed',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: LLM упал — сохраняю «сухой» вариант',
      );
      const fallback = buildFallbackDigestMarkdown(promptInput);
      bodyMarkdown = fallback.bodyMarkdown;
      shortSummary = fallback.shortSummary;
    }

    // Upsert идемпотентен по `(tenantId, dateLocal)`.
    const row = await this.prisma.dailyOperationsDigest.upsert({
      where: {
        tenantId_dateLocal: {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
        },
      },
      create: {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
        bodyMarkdown,
        shortSummary,
        metricsJson: aggregates.metrics as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
      },
      update: {
        bodyMarkdown,
        shortSummary,
        metricsJson: aggregates.metrics as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        // deliveredAt НЕ обнуляем при regenerate — если уже доставили,
        // повторная регенерация не должна посылать новый Telegram.
      },
    });

    this.metrics.incCooDailyDigestGenerated({ tenantTop });
    // Обновляем gauge «возраст последнего дайджеста» (now − createdAt).
    this.metrics.setCooDailyDigestAge({
      tenantTop,
      value: Math.max(0, (Date.now() - row.createdAt.getTime()) / 1000),
    });
    return this.enrichDto(this.toDto(row));
  }

  /**
   * Пометить дайджест как доставленный в Telegram. Best-effort upsert
   * без обновления текста.
   */
  async markDelivered(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<void> {
    await this.prisma.dailyOperationsDigest.updateMany({
      where: {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
      },
      data: { deliveredAt: new Date() },
    });
  }

  /**
   * Агрегация источников: чек-ины, новые блокеры, просроченные обещания,
   * цели, новые high-severity инсайты, решения за вчерашний день.
   * Выделена для тестирования без LLM.
   */
  async aggregate(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<{ metrics: DailyDigestMetricsDto; sources: DailyDigestSourcesDto }> {
    // Окно дня в UTC: [00:00, 24:00) того же UTC-дня. dateLocal — это уже
    // дата в МСК (cron подаёт «вчера в МСК»), но индексы по `lastObservedAt` /
    // `createdAt` / `updatedAt` — DateTime UTC. Для МСК (UTC+3) использование
    // UTC-окна того же дня даёт окно `00:00..03:00 МСК следующего дня` —
    // это ОК для β-8.3 MVP (РФ ICP), как и в weekly-digest.
    const dayStart = parseDateLocalToUtc(args.dateLocal);
    const dayEnd = endOfDayUtc(dayStart);

    const [
      checkIns,
      redCheckIns,
      newBlockers,
      overdueCommitments,
      goalsChanged,
      highInsights,
      decisions,
    ] = await Promise.all([
      // Чек-ины дня — для долей green/yellow/red.
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: { in: ['green', 'yellow', 'red'] },
          dateLocal: args.dateLocal,
        },
        select: { sentiment: true, id: true },
      }),
      // Топ-3 «красных» — с именем и началом rawResponseText.
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: 'red',
          dateLocal: args.dateLocal,
        },
        select: {
          id: true,
          rawResponseText: true,
          person: { select: { name: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 3,
      }),
      // Новые блокеры за день: signalType='blocker', createdAt в окне.
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'blocker',
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          name: true,
          confidence: true,
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      // Просроченные обещания на сегодня: commitmentStatus IN ('open','asked'),
      // commitmentDueDate <= конец вчерашнего дня (т.е. сегодня уже просрочено).
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: { in: ['open', 'asked'] },
          commitmentDueDate: { lte: dayEnd },
        },
        select: {
          id: true,
          name: true,
          commitmentDueDate: true,
          commitmentRecipientPersonId: true,
        },
        orderBy: { commitmentDueDate: 'asc' },
        take: 5,
      }),
      // Цели, у которых вчера изменился статус (updatedAt в окне).
      this.prisma.goal.findMany({
        where: {
          tenantId: args.tenantId,
          updatedAt: { gte: dayStart, lte: dayEnd },
        },
        select: { id: true, status: true, archivedAt: true },
      }),
      // Новые high-severity инсайты за вчера (firstObservedAt в окне).
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          severity: 'high',
          firstObservedAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          statement: true,
          kind: true,
          causeCategory: true,
        },
        orderBy: { firstObservedAt: 'desc' },
        take: 5,
      }),
      // Решения за вчера (decidedAt в окне).
      this.prisma.decision.findMany({
        where: {
          tenantId: args.tenantId,
          decidedAt: { gte: dayStart, lte: dayEnd },
        },
        select: { id: true, statement: true, text: true, status: true },
        orderBy: { decidedAt: 'desc' },
        take: 5,
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

    // Цели: caмиc-изменения вчера.
    const completedGoals = goalsChanged.filter((g0) => g0.status === 'achieved');
    const failedGoals = goalsChanged.filter((g0) => g0.status === 'abandoned');
    const activatedGoals = goalsChanged.filter(
      (g0) => g0.status === 'active' && g0.archivedAt === null,
    );

    const metrics: DailyDigestMetricsDto = {
      totalCheckIns: total,
      greenShare: total > 0 ? g / total : 0,
      yellowShare: total > 0 ? y / total : 0,
      redShare: total > 0 ? r / total : 0,
      topRedCheckIns: redCheckIns.map((c) => ({
        checkInId: c.id,
        personName: c.person?.name ?? null,
        excerpt: (c.rawResponseText ?? '').slice(0, 200),
      })),
      newBlockers: newBlockers.map((b) => ({
        blockId: b.id,
        name: (b.name ?? '').slice(0, 400),
        confidence: Number(b.confidence),
      })),
      overdueCommitments: overdueCommitments.map((c) => ({
        blockId: c.id,
        name: (c.name ?? '').slice(0, 400),
        dueDate: c.commitmentDueDate
          ? c.commitmentDueDate.toISOString().slice(0, 10)
          : null,
        recipientPersonId: c.commitmentRecipientPersonId,
      })),
      goals: {
        completed: completedGoals.length,
        failed: failedGoals.length,
        activated: activatedGoals.length,
        completedIds: completedGoals.map((g0) => g0.id),
        failedIds: failedGoals.map((g0) => g0.id),
      },
      newHighInsights: highInsights.map((i) => ({
        insightId: i.id,
        statement: (i.statement ?? '').slice(0, 400),
        kind: i.kind,
        causeCategory: i.causeCategory,
      })),
      decisions: decisions.map((d) => ({
        decisionId: d.id,
        statement: (d.statement ?? d.text ?? '').slice(0, 400),
        status: d.status,
      })),
    };

    const sources: DailyDigestSourcesDto = {
      checkInIds: checkIns.map((c) => c.id),
      blockerIds: newBlockers.map((b) => b.id),
      commitmentIds: overdueCommitments.map((c) => c.id),
      goalIds: goalsChanged.map((g0) => g0.id),
      insightIds: highInsights.map((i) => i.id),
      decisionIds: decisions.map((d) => d.id),
    };

    return { metrics, sources };
  }

  /** Преобразование Prisma-row в DTO.
   *
   *  Pulse Wave 2 §2.1: 4 расширенных секции (eventsToday/urgentItems/
   *  whoShined/whoStruggled) — НЕ хранятся в БД; здесь возвращаем пустые
   *  массивы, которые потом заполняются `enrichDto()` через
   *  `computeRuntimeSections()`. Пустые дефолты гарантируют, что DTO
   *  type-корректен даже в ветке, где enrich не вызывается (например,
   *  в unit-тестах).
   */
  private toDto(row: {
    id: string;
    tenantId: string;
    dateLocal: string;
    bodyMarkdown: string;
    metricsJson: unknown;
    sourcesJson: unknown;
    llmTaskRouteId: string | null;
    shortSummary: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
  }): DailyOperationsDigestDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      dateLocal: row.dateLocal,
      bodyMarkdown: row.bodyMarkdown,
      shortSummary: row.shortSummary,
      metrics: (row.metricsJson as DailyDigestMetricsDto) ?? emptyMetrics(),
      sources: (row.sourcesJson as DailyDigestSourcesDto) ?? emptySources(),
      llmTaskRouteId: row.llmTaskRouteId,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      // Pulse Wave 2 §2.1 — расширенные секции; реально заполняются enrichDto().
      eventsToday: [],
      urgentItems: [],
      whoShined: [],
      whoStruggled: [],
    };
  }

  /**
   * Pulse Wave 2 §2.1 — обогащение DTO runtime-вычисленными секциями
   * (eventsToday / urgentItems / whoShined / whoStruggled). НЕ-блокирующее
   * на ошибки: если запрос упал, возвращаем DTO с пустыми секциями (а не
   * ломаем выдачу всего отчёта).
   */
  private async enrichDto(
    dto: DailyOperationsDigestDto,
  ): Promise<DailyOperationsDigestDto> {
    try {
      const sections = await this.computeRuntimeSections({
        tenantId: dto.tenantId,
        dateLocal: dto.dateLocal,
      });
      return { ...dto, ...sections };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: dto.tenantId,
          dateLocal: dto.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: computeRuntimeSections упал — возвращаю DTO без расширенных секций',
      );
      return dto;
    }
  }

  /**
   * Pulse Wave 2 §2.1 — собирает 4 секции одной волной параллельных запросов.
   *
   * НЕ персистится в БД (`DailyOperationsDigest.metricsJson` хранит только
   * базовые метрики). Вычисляется при каждой выдаче — данные «свежие на момент
   * чтения», что важно для urgentItems (просроченные обещания меняются в
   * течение дня).
   *
   * Окно «вчерашних суток» — `parseDayBoundsMsk(dateLocal)`. Для urgentItems
   * используется `now`, а не `dayEnd`, потому что просрочка считается на момент
   * запроса дайджеста (читаешь утром — на этот момент просрочка реальная).
   */
  private async computeRuntimeSections(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<{
    eventsToday: DailyDigestEventDto[];
    urgentItems: DailyDigestUrgentItemDto[];
    whoShined: DailyDigestPersonShinedDto[];
    whoStruggled: DailyDigestPersonStruggledDto[];
  }> {
    const [dayStart, dayEnd] = this.parseDayBoundsMsk(args.dateLocal);
    const now = new Date();

    const [
      meetingsToday,
      decisionsToday,
      criticalSignals,
      overdueCommits,
      raisedDecisions,
      highInsights,
      redCheckIns,
      brokenCommits,
      persons,
    ] = await Promise.all([
      // События дня: встречи завершились вчера (Meeting.endedAt, не completedAt).
      this.prisma.meeting.findMany({
        where: {
          tenantId: args.tenantId,
          endedAt: { gte: dayStart, lt: dayEnd },
          deletedAt: null,
        },
        select: { id: true, title: true, endedAt: true, durationMs: true },
        take: 30,
        orderBy: { endedAt: 'asc' },
      }),
      // События дня: решения принятые вчера (по createdAt).
      this.prisma.decision.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true, statement: true, status: true, createdAt: true },
        take: 30,
        orderBy: { createdAt: 'asc' },
      }),
      // События дня: critical-сигналы (IdeaBlock signalType ∈ {churn_risk,risk,pain},
      // confidence ≥ 0.8). pain в Z трактуется как high-severity сигнал.
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: dayStart, lt: dayEnd },
          signalType: { in: ['churn_risk', 'risk', 'pain'] },
          confidence: { gte: new Prisma.Decimal(0.8) },
        },
        select: { id: true, name: true, signalType: true, createdAt: true },
        take: 10,
        orderBy: { createdAt: 'asc' },
      }),
      // Urgent: просроченные обещания (active, due прошло).
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: { in: ['open', 'asked'] },
          commitmentDueDate: { lt: now },
        },
        select: { id: true, name: true, commitmentDueDate: true },
        take: 10,
        orderBy: { commitmentDueDate: 'asc' },
      }),
      // Urgent: решения с raisedCount ≥ 2 (Фаза 1.2 — кол-во упоминаний).
      this.prisma.decision.findMany({
        where: {
          tenantId: args.tenantId,
          status: { in: ['proposed', 'approved', 'active'] },
          raisedCount: { gte: 2 },
        },
        select: { id: true, statement: true, raisedCount: true },
        take: 10,
        orderBy: { raisedCount: 'desc' },
      }),
      // Urgent: high-insights, появившиеся вчера, ещё активные.
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          severity: 'high',
          status: { not: 'archived' },
          firstObservedAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true, statement: true },
        take: 5,
        orderBy: { firstObservedAt: 'desc' },
      }),
      // Struggled: красные чек-ины вчера. Окно — по `dateLocal` (строка YYYY-MM-DD)
      // как в `aggregate()`, чтобы совпадало с базовыми метриками.
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: 'red',
          dateLocal: args.dateLocal,
        },
        select: {
          id: true,
          personId: true,
          sentimentRationale: true,
          person: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      // Struggled: вчера broken commitments (commitmentStatus='missed',
      // updatedAt в окне вчерашнего дня).
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: 'missed',
          updatedAt: { gte: dayStart, lt: dayEnd },
        },
        select: {
          id: true,
          name: true,
          commitmentRecipient: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      // Person-map для безопасного отображения имени.
      this.prisma.person.findMany({
        where: { tenantId: args.tenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const personById = new Map<string, string>(
      persons.map((p) => [p.id, p.name]),
    );

    // ============== eventsToday ==============
    const eventsToday: DailyDigestEventDto[] = [];
    for (const m of meetingsToday) {
      if (!m.endedAt) continue;
      const durationMin = m.durationMs
        ? Math.max(1, Math.round(m.durationMs / 60_000))
        : null;
      eventsToday.push({
        kind: 'meeting',
        id: m.id,
        title: m.title ?? 'Встреча',
        occurredAt: m.endedAt.toISOString(),
        link: `/meetings/${encodeURIComponent(m.id)}/result`,
        ...(durationMin ? { detail: `${durationMin} мин` } : {}),
      });
    }
    for (const d of decisionsToday) {
      eventsToday.push({
        kind: 'decision',
        id: d.id,
        title: (d.statement ?? 'Решение').slice(0, 100),
        occurredAt: d.createdAt.toISOString(),
        link: `/decisions/${encodeURIComponent(d.id)}`,
        detail: d.status,
      });
    }
    for (const s of criticalSignals) {
      eventsToday.push({
        kind: 'signal',
        id: s.id,
        title: s.name,
        occurredAt: s.createdAt.toISOString(),
        link: `/themes?block=${encodeURIComponent(s.id)}`,
        detail: s.signalType,
      });
    }
    eventsToday.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    // ============== urgentItems ==============
    const urgentItems: DailyDigestUrgentItemDto[] = [];
    for (const c of overdueCommits) {
      const daysOverdue = c.commitmentDueDate
        ? Math.max(
            1,
            Math.floor(
              (now.getTime() - c.commitmentDueDate.getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : 0;
      urgentItems.push({
        kind: 'overdue_commitment',
        id: c.id,
        title: (c.name ?? '').slice(0, 100),
        link: `/me/commitments?id=${encodeURIComponent(c.id)}`,
        badge: `просрочено на ${daysOverdue} ${daysOverdue === 1 ? 'день' : 'дн.'}`,
        urgency: daysOverdue >= 3 ? 'high' : 'medium',
      });
    }
    for (const d of raisedDecisions) {
      urgentItems.push({
        kind: 'raised_decision',
        id: d.id,
        title: (d.statement ?? 'Решение').slice(0, 100),
        link: `/decisions/${encodeURIComponent(d.id)}`,
        badge: `поднималось ${d.raisedCount} раз`,
        urgency: d.raisedCount >= 4 ? 'high' : 'medium',
      });
    }
    for (const i of highInsights) {
      urgentItems.push({
        kind: 'high_insight',
        id: i.id,
        title: (i.statement ?? '').slice(0, 100),
        link: `/insights?id=${encodeURIComponent(i.id)}`,
        badge: 'high',
        urgency: 'medium',
      });
    }

    // ============== whoShined ==============
    // V1: пусто. Полная реализация — Фаза 2.2/2.3 (recognition events,
    // helpful acts, kept commitments) — отдельная инфраструктура.
    const whoShined: DailyDigestPersonShinedDto[] = [];

    // ============== whoStruggled ==============
    // Дедуп по personId: первая причина выигрывает (red_checkin > broken_commitment).
    const struggledMap = new Map<string, DailyDigestPersonStruggledDto>();
    for (const r of redCheckIns) {
      const name = r.person?.name ?? personById.get(r.personId) ?? 'Без имени';
      if (!struggledMap.has(r.personId)) {
        struggledMap.set(r.personId, {
          personId: r.personId,
          personName: name,
          reason: 'red_checkin',
          detail:
            (r.sentimentRationale ?? '').slice(0, 120) || 'красный чек-ин',
          link: `/persons/${encodeURIComponent(r.personId)}`,
        });
      }
    }
    for (const c of brokenCommits) {
      if (!c.commitmentRecipient) continue;
      const pid = c.commitmentRecipient.id;
      if (struggledMap.has(pid)) continue;
      struggledMap.set(pid, {
        personId: pid,
        personName: c.commitmentRecipient.name ?? 'Без имени',
        reason: 'broken_commitment',
        detail: `Не выполнено: ${(c.name ?? '').slice(0, 80)}`,
        link: `/persons/${encodeURIComponent(pid)}`,
      });
    }
    const whoStruggled = Array.from(struggledMap.values()).slice(0, 8);

    return { eventsToday, urgentItems, whoShined, whoStruggled };
  }

  /**
   * `dateLocal` (YYYY-MM-DD) интерпретируется как день в МСК (UTC+3 без DST).
   * Возвращает `[start, end)` в UTC: start = 00:00 МСК = 21:00 UTC предыдущего
   * UTC-дня; end = 24:00 МСК = 21:00 UTC текущего UTC-дня.
   *
   * Это окно ОТЛИЧАЕТСЯ от `aggregate()` (которое использует UTC-окно того же
   * UTC-дня — упрощение β-8.3 MVP). Для расширенных секций нам важнее точность
   * границы суток в МСК — пользователь читает «вчерашний отчёт» утром и
   * ожидает события именно вчерашнего календарного дня в МСК.
   */
  private parseDayBoundsMsk(dateLocal: string): [Date, Date] {
    const [y, m, d] = dateLocal.split('-').map(Number);
    if (!y || !m || !d) {
      // Безопасный fallback — последние 24 часа.
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return [start, end];
    }
    const start = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0));
    return [start, end];
  }
}

function emptyMetrics(): DailyDigestMetricsDto {
  return {
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    topRedCheckIns: [],
    newBlockers: [],
    overdueCommitments: [],
    goals: {
      completed: 0,
      failed: 0,
      activated: 0,
      completedIds: [],
      failedIds: [],
    },
    newHighInsights: [],
    decisions: [],
  };
}

function emptySources(): DailyDigestSourcesDto {
  return {
    checkInIds: [],
    blockerIds: [],
    commitmentIds: [],
    goalIds: [],
    insightIds: [],
    decisionIds: [],
  };
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
