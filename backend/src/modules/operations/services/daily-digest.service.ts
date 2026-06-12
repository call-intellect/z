import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { PendingActionsService } from '../../pending-actions/services/pending-actions.service';
import type {
  DailyDigestMetricsDto,
  DailyDigestSourcesDto,
  DailyDigestAggregates,
  DailyOperationsDigestDto,
  DailyDigestEventDto,
  DailyDigestUrgentItemDto,
  DailyDigestPersonShinedDto,
  DailyDigestPersonStruggledDto,
  DailyDigestCustomerAtRiskDto,
  DailyDigestChronicBlockerDto,
  DailyDigestTrendPointDto,
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

import { BlockerSynthesisService } from './blocker-synthesis.service';
import { CustomerRiskRadarService } from './customer-risk-radar.service';

/**
 * Ф1b редизайна дашбордов — чистый маппер persisted-снимков daily-дайджеста
 * в трендовые точки. Принимает строки в порядке DESC по `dateLocal`
 * (как их отдаёт `findMany orderBy desc`) и возвращает точки в порядке
 * old→new (через `.reverse()`). `metricsJson` парсится безопасно: любые
 * отсутствующие/невалидные поля деградируют в 0 (точка не падает).
 */
export function mapDailyDigestRowsToTrend(
  rowsDesc: Array<{ dateLocal: string; metricsJson: unknown }>,
): DailyDigestTrendPointDto[] {
  return rowsDesc
    .map((r) => {
      const m = (r.metricsJson ?? {}) as Record<string, unknown>;
      const goals = (m.goals ?? {}) as Record<string, unknown>;
      return {
        dateLocal: r.dateLocal,
        totalCheckIns: Number(m.totalCheckIns ?? 0),
        greenShare: Number(m.greenShare ?? 0),
        redShare: Number(m.redShare ?? 0),
        blockers: Array.isArray(m.newBlockers) ? m.newBlockers.length : 0,
        overdueCommitments: Array.isArray(m.overdueCommitments)
          ? m.overdueCommitments.length
          : 0,
        goalsCompleted: Number(goals.completed ?? 0),
        goalsFailed: Number(goals.failed ?? 0),
      };
    })
    .reverse();
}

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
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    // TZ-1 Фаза 1 (daily-value-engine) — мост секции «Клиенты под риском».
    @Inject(CustomerRiskRadarService)
    private readonly customerRisk: CustomerRiskRadarService,
    // ТЗ-2 Ф3 — мост секции «Хронические блокеры» (тот же OperationsModule).
    @Inject(BlockerSynthesisService)
    private readonly blockerSynthesis: BlockerSynthesisService,
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
   * Action Center B3 — блок «Ждёт подтверждения» для конкретного получателя
   * дайджеста. Возвращает готовую markdown-строку (с переводом строки в начале)
   * или `null`, если у получателя нет pending-элементов.
   *
   * Best-effort: при любой ошибке `PendingActionsService` возвращает `null` —
   * не должен валить доставку дайджеста.
   */
  async buildPendingActionsLine(args: {
    tenantId: string;
    userId: string;
  }): Promise<string | null> {
    try {
      const count = await this.pendingActions.getCount({
        tenantId: args.tenantId,
        userId: args.userId,
      });
      if (count.total === 0) return null;
      return `\n\n🔔 Ждёт вашего подтверждения: ${count.total}. Открыть: /actions`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          userId: args.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: блок «Ждёт подтверждения» упал — пропускаю',
      );
      return null;
    }
  }

  /**
   * TZ-1 Ф1 — строка «Клиенты под риском» для тела дайджеста (Telegram/in_app).
   * Возвращает готовую markdown-строку (с переводом строки в начале) или `null`,
   * если снимков нет. Best-effort: при ошибке радара — `null`, не валит дайджест.
   */
  async buildCustomersAtRiskLine(args: {
    tenantId: string;
  }): Promise<string | null> {
    try {
      const top = await this.customerRisk.topForDigest({
        tenantId: args.tenantId,
        limit: 3,
      });
      if (top.length === 0) return null;
      const lines = top.map(
        (c) =>
          `• ${c.customerName.slice(0, 60)} — ${
            c.riskLevel === 'critical' ? 'критический' : 'повышенный'
          }`,
      );
      return `\n\n⚠️ Клиенты под риском:\n${lines.join('\n')}`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: строка «Клиенты под риском» упала — пропускаю',
      );
      return null;
    }
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

  /**
   * Ф1b — исторический тренд daily-дайджеста из уже persisted-снимков.
   * Берём до `days` последних строк за дату ≤ текущей (`lte`), сортируем
   * DESC по `dateLocal` (строки YYYY-MM-DD лексикографически сортируемы),
   * затем чистый маппер разворачивает их в old→new. Best-effort: любая
   * ошибка БД → пустой тренд (не ломаем выдачу дайджеста).
   */
  private async buildDailyTrend(
    tenantId: string,
    dateLocal: string,
    days = 14,
  ): Promise<DailyDigestTrendPointDto[]> {
    try {
      const rows = await this.prisma.dailyOperationsDigest.findMany({
        where: { tenantId, dateLocal: { lte: dateLocal } },
        orderBy: { dateLocal: 'desc' },
        take: days,
        select: { dateLocal: true, metricsJson: true },
      });
      return mapDailyDigestRowsToTrend(rows);
    } catch {
      return [];
    }
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
      // TZ-1 Ф1 — реально заполняется enrichDto() → computeRuntimeSections().
      customersAtRisk: [],
      // ТЗ-2 Ф3 — реально заполняется enrichDto() → computeRuntimeSections().
      chronicBlockers: [],
      // Ф1b — реально заполняется enrichDto() → buildDailyTrend().
      trend: [],
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
      // Ф1b — исторический тренд кладём в тот же ответ (один вызов фронта).
      // buildDailyTrend сам глотает ошибку → [], так что enrich не падает.
      const trend = await this.buildDailyTrend(dto.tenantId, dto.dateLocal);
      return { ...dto, ...sections, trend };
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
    customersAtRisk: DailyDigestCustomerAtRiskDto[];
    chronicBlockers: DailyDigestChronicBlockerDto[];
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
      recognitionsToday,
      helpfulnessToday,
      keptCommits,
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
      // Shined: благодарности/признания, полученные вчера (Recognition.createdAt
      // в окне). Группируются по получателю toUserId → Person.
      this.prisma.recognition.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
        select: { toUserId: true, type: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Shined: «полезные действия» — HelpfulnessSpotlight, чей период пересекает
      // вчерашний день ИЛИ запись создана вчера. helperUserId → Person.
      this.prisma.helpfulnessSpotlight.findMany({
        where: {
          tenantId: args.tenantId,
          OR: [
            { periodFrom: { lte: dayEnd }, periodTo: { gte: dayStart } },
            { createdAt: { gte: dayStart, lt: dayEnd } },
          ],
        },
        select: { helperUserId: true, helpCount: true },
        orderBy: { helpCount: 'desc' },
        take: 20,
      }),
      // Shined: сдержанные обещания — commitment со статусом 'fulfilled',
      // updatedAt в окне вчерашнего дня. Автор — commitmentAuthorPersonId
      // (ДЕТЕРМИНИРОВАННАЯ атрибуция по identity, НЕ получатель).
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: 'fulfilled',
          updatedAt: { gte: dayStart, lt: dayEnd },
          commitmentAuthorPersonId: { not: null },
        },
        select: {
          id: true,
          name: true,
          commitmentAuthorPersonId: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      // Person-map для безопасного отображения имени.
      this.prisma.person.findMany({
        where: { tenantId: args.tenantId, deletedAt: null },
        select: { id: true, name: true, userId: true },
      }),
    ]);

    const personById = new Map<string, string>(
      persons.map((p) => [p.id, p.name]),
    );
    // userId → Person (для атрибуции Recognition.toUserId и
    // HelpfulnessSpotlight.helperUserId, которые ссылаются на User, не Person).
    const personByUserId = new Map<string, { id: string; name: string }>();
    for (const p of persons) {
      if (p.userId && p.name) personByUserId.set(p.userId, { id: p.id, name: p.name });
    }

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
        badge: 'важный сигнал',
        urgency: 'medium',
      });
    }

    // ============== whoShined ==============
    // ТЗ-C Ф4 (2026-06-05, R6) — позитивная секция «Кто выделился».
    // Дедуп по personId с приоритетом причин:
    //   recognition_received > helpful_acts > commitments_kept.
    // Источники собираются в этом порядке; запись с более высоким приоритетом
    // не перезаписывается более низким (см. `map.has(...) continue`).
    // Person без имени / без привязки userId — ПРОПУСКАЕМ (в позитивной
    // секции «Без имени» недопустим).
    const shinedMap = new Map<string, DailyDigestPersonShinedDto>();

    // 1) recognition_received — благодарности по получателю (toUserId → Person).
    const recognitionByUser = new Map<
      string,
      { count: number; lastType: string | null }
    >();
    for (const rec of recognitionsToday) {
      if (!rec.toUserId) continue;
      const prev = recognitionByUser.get(rec.toUserId);
      if (prev) {
        prev.count += 1;
        // recognitionsToday отсортирован по createdAt desc → первый встреченный
        // type и есть последний по времени; не перезаписываем.
      } else {
        recognitionByUser.set(rec.toUserId, {
          count: 1,
          lastType: rec.type ?? null,
        });
      }
    }
    for (const [userId, agg] of recognitionByUser) {
      const person = personByUserId.get(userId);
      if (!person) continue;
      if (shinedMap.has(person.id)) continue;
      shinedMap.set(person.id, {
        personId: person.id,
        personName: person.name,
        reason: 'recognition_received',
        detail: this.buildRecognitionDetail(agg.count, agg.lastType),
        link: `/persons/${encodeURIComponent(person.id)}`,
      });
    }

    // 2) helpful_acts — HelpfulnessSpotlight по helperUserId → Person.
    const helpCountByUser = new Map<string, number>();
    for (const h of helpfulnessToday) {
      if (!h.helperUserId) continue;
      helpCountByUser.set(
        h.helperUserId,
        (helpCountByUser.get(h.helperUserId) ?? 0) + (h.helpCount ?? 0),
      );
    }
    for (const [userId, helpCount] of helpCountByUser) {
      const person = personByUserId.get(userId);
      if (!person) continue;
      if (shinedMap.has(person.id)) continue;
      const n = Math.max(1, helpCount);
      shinedMap.set(person.id, {
        personId: person.id,
        personName: person.name,
        reason: 'helpful_acts',
        detail: `помог ${n} ${pluralizeRaz(n)}`,
        link: `/persons/${encodeURIComponent(person.id)}`,
      });
    }

    // 3) commitments_kept — сдержанные обещания по commitmentAuthorPersonId.
    // Атрибуция ТОЛЬКО по автору (commitmentAuthorPersonId), не получателю.
    const keptByAuthor = new Map<string, { count: number; lastName: string }>();
    for (const c of keptCommits) {
      const authorId = c.commitmentAuthorPersonId;
      if (!authorId) continue;
      const prev = keptByAuthor.get(authorId);
      if (prev) {
        prev.count += 1;
      } else {
        keptByAuthor.set(authorId, {
          count: 1,
          lastName: (c.name ?? '').trim(),
        });
      }
    }
    for (const [personId, agg] of keptByAuthor) {
      const name = personById.get(personId);
      if (!name) continue;
      if (shinedMap.has(personId)) continue;
      const detail =
        agg.count === 1 && agg.lastName
          ? `сдержал обещание: ${agg.lastName.slice(0, 80)}`
          : `закрыл ${agg.count} ${pluralizeObeshchanie(agg.count)}`;
      shinedMap.set(personId, {
        personId,
        personName: name,
        reason: 'commitments_kept',
        detail,
        link: `/persons/${encodeURIComponent(personId)}`,
      });
    }

    const whoShined = Array.from(shinedMap.values()).slice(0, 8);

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

    // ============== customersAtRisk (TZ-1 Ф1) ==============
    // Топ клиентов под риском (critical/warning) по riskScore. Best-effort:
    // если радар не строил снимков — секция пустая, дайджест не ломается.
    let customersAtRisk: DailyDigestCustomerAtRiskDto[] = [];
    try {
      const top = await this.customerRisk.topForDigest({
        tenantId: args.tenantId,
        limit: 5,
      });
      customersAtRisk = top.map((c) => ({
        customerName: c.customerName,
        riskLevel: c.riskLevel === 'critical' ? 'critical' : 'warning',
        badge: buildCustomerRiskBadge(c.signalCounts),
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: секция «Клиенты под риском» упала — пропускаю',
      );
    }

    // ============== chronicBlockers (ТЗ-2 Ф3) ==============
    // Топ хронических блокеров (new/recurring) по businessImpactScore из
    // BlockerSynthesisService. Best-effort: если синтеза нет / упал — `[]`,
    // дайджест не ломается. Поля businessImpactScore/даты в DTO не выносим.
    let chronicBlockers: DailyDigestChronicBlockerDto[] = [];
    try {
      const chronic = await this.blockerSynthesis.listChronicForTenant({
        tenantId: args.tenantId,
        limit: 5,
      });
      chronicBlockers = chronic.map((c) => ({
        id: c.id,
        representativeText: c.representativeText,
        status: c.status,
        daysOpen: c.daysOpen,
        linkedInsightId: c.linkedInsightId,
        responsiblePersonId: c.responsiblePersonId,
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: секция «Хронические блокеры» упала — пропускаю',
      );
    }

    return {
      eventsToday,
      urgentItems,
      whoShined,
      whoStruggled,
      customersAtRisk,
      chronicBlockers,
    };
  }

  /**
   * Человеческий русский текст для detail причины `recognition_received`.
   * ТЗ-C Ф4 (R6) — ограничение DTO `detail` ≤ 120 символов соблюдается
   * с запасом.
   */
  private buildRecognitionDetail(count: number, lastType: string | null): string {
    const base = `${count} ${pluralizeBlagodarnost(count)}`;
    const human = lastType ? recognitionTypeRu(lastType) : null;
    if (human) return `${base} — ${human}`.slice(0, 120);
    return base.slice(0, 120);
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

/**
 * Русское склонение по числу: возвращает форму для «1 / 2–4 / 5+».
 * Для русских числительных учитываем особенность 11–14 (всегда «много»).
 */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function pluralizeRaz(n: number): string {
  // 1 раз / 2 раза / 5 раз.
  return pluralRu(n, 'раз', 'раза', 'раз');
}

function pluralizeBlagodarnost(n: number): string {
  // 1 благодарность / 2 благодарности / 5 благодарностей.
  return pluralRu(n, 'благодарность', 'благодарности', 'благодарностей');
}

function pluralizeObeshchanie(n: number): string {
  // 1 обещание / 2 обещания / 5 обещаний.
  return pluralRu(n, 'обещание', 'обещания', 'обещаний');
}

/**
 * TZ-1 Ф1 — короткий бейдж по преобладающим сигналам клиента (без ₽). Например
 * «отток ×2, возражения ×1».
 */
function buildCustomerRiskBadge(counts: {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
}): string {
  const parts: string[] = [];
  if (counts.churn_risk > 0) parts.push(`отток ×${counts.churn_risk}`);
  if (counts.objection > 0) parts.push(`возражения ×${counts.objection}`);
  if (counts.pain > 0) parts.push(`боли ×${counts.pain}`);
  if (counts.feature_request > 0) parts.push(`доработки ×${counts.feature_request}`);
  return parts.join(', ') || 'сигналы';
}

/**
 * Человекочитаемое русское название типа благодарности (Recognition.type).
 * Источник типов — schema.prisma `Recognition` (thanks_comment, thanks_helpfulness,
 * mention_helped, idea_shipped, streak_milestone, weekly_summary). Неизвестный
 * тип → null (тогда detail остаётся без уточнения).
 */
function recognitionTypeRu(type: string): string | null {
  switch (type) {
    case 'thanks_comment':
      return 'спасибо за комментарий';
    case 'thanks_helpfulness':
      return 'спасибо за помощь';
    case 'mention_helped':
      return 'отметили, что помог';
    case 'idea_shipped':
      return 'идея пошла в дело';
    case 'streak_milestone':
      return 'серия активности';
    case 'weekly_summary':
      return 'итоги недели';
    default:
      return null;
  }
}
