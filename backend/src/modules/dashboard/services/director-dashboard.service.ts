import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminCacheService } from '../../admin/services/admin-cache.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { PendingActionsService } from '../../pending-actions/services/pending-actions.service';
import type {
  DirectorDashboardAlertGoalDto,
  DirectorDashboardDto,
  DirectorDashboardEntityDto,
  DirectorDashboardGoalsPulseDto,
  DirectorDashboardGoalTreeNodeDto,
  DirectorDashboardKpiDto,
  DirectorDashboardOpenQuestionDto,
  DirectorDashboardRequiresActionDto,
  DirectorDashboardSignalCountersDto,
  DirectorDashboardSignalDto,
  DirectorDashboardStrategicAlignmentDto,
  DirectorDashboardThemeDto,
  DirectorDashboardValueStripDto,
  NarrativeSummaryDto,
} from '../dto/director-dashboard.dto';
import {
  buildDashboardSummaryUserMessage,
  DASHBOARD_SUMMARY_SYSTEM_PROMPT,
} from '../prompts/dashboard-summary.prompt';
import { CommitmentReliabilityService } from './commitment-reliability.service';
import { HangingDecisionsService } from './hanging-decisions.service';
import {
  NarrativeCitationsParserService,
  type CitationSource,
} from './narrative-citations-parser.service';
import {
  SAMPLE_STORY_DATASET,
  SAMPLE_STORY_NARRATIVE,
} from './sample-story.dataset';
import { SentimentIndexService } from './sentiment-index.service';

/**
 * DirectorDashboardService (Фаза 8 knowledge-core).
 *
 * Формирует агрегированный срез знаний компании за период (week=7д, month=30д)
 * для дашборда директора. Один публичный метод `getDirectorView({tenantId, period})`
 * возвращает 6 виджетов в одном объекте + опциональный `narrativeSummary` (LLM).
 *
 * Архитектура:
 *   - Все 6 запросов к БД — параллельно через Promise.all (см. ТЗ §«критерий DoD»).
 *   - Кэш через `AdminCacheService` (in-memory, TTL 60s) — ключ `dashboard:director:${tenantId}:${period}`.
 *   - `narrativeSummary` в этом коммите — заглушка (null). LLM-часть — Шаг 2.
 *
 * Совместимость: полагается на структуру моделей Theme/IdeaBlock/Entity/IdeaBlockEntity/
 * IdeaBlockEvidence/RawEvent (Фазы 2-4 knowledge-core).
 */

const SIGNAL_TYPES_FOR_NEW_SIGNALS: SignalType[] = [
  'pain',
  'churn_risk',
  'risk',
  'feature_request',
  'decision',
  'commitment',
  'competitor_move',
  'metric_change',
];

const TRUSTED_ANSWER_TRUNCATE = 280;
const DASHBOARD_TTL_MS = 60_000;
const NARRATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NARRATIVE_CACHE_PREFIX = 'dashboard:director:narrative:';

@Injectable()
export class DirectorDashboardService {
  private readonly logger = new Logger(DirectorDashboardService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(NarrativeCitationsParserService)
    private readonly citations: NarrativeCitationsParserService,
    @Inject(SentimentIndexService)
    private readonly sentimentSvc: SentimentIndexService,
    @Inject(CommitmentReliabilityService)
    private readonly commitSvc: CommitmentReliabilityService,
    @Inject(HangingDecisionsService)
    private readonly hangingSvc: HangingDecisionsService,
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    @Inject(TypedConfigService)
    private readonly config: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Главный метод: возвращает срез знаний компании за период.
   * Кэш 60s по ключу (tenantId, period). На повторный запрос внутри окна —
   * не дёргает БД.
   */
  async getDirectorView(args: {
    tenantId: string;
    period: 'week' | 'month';
    userId?: string;
  }): Promise<DirectorDashboardDto> {
    // userId входит в ключ — блок requiresAction персональный (pending-
    // подтверждения текущего пользователя), нельзя отдавать чужой счётчик
    // из кэша. Без userId (старые вызовы) — ключ без суффикса.
    const cacheKey = `dashboard:director:${args.tenantId}:${args.period}${
      args.userId ? `:u:${args.userId}` : ''
    }`;
    const cached = this.cache.get<DirectorDashboardDto>(cacheKey);
    if (cached) {
      return cached;
    }

    // Action Center B2 — блок «Требует вашего подтверждения». Best-effort:
    // ошибка PendingActionsService не должна валить весь дашборд.
    const requiresAction = args.userId
      ? await this.fetchRequiresAction(args.tenantId, args.userId)
      : undefined;

    const since = this.calcSince(args.period);

    // Б-1 устойчивость: главная директора — витрина продукта, не должна
    // «умирать» целиком из-за падения одного виджета. Каждый запрос ниже
    // оборачиваем в safe(): при ошибке БД виджет деградирует до нейтрального
    // fallback'а, а в логах остаётся ИМЯ упавшего виджета (раньше глобальный
    // фильтр отдавал общий db_error без детализации). Тот же best-effort уже
    // применён к requiresAction и narrativeSummary в этом же сервисе.
    // NoInfer<T> на fallback гарантирует, что T выводится строго из fn (возврат
    // сервисного метода), а object-literal fallback контекстно типизируется
    // под него (иначе trend:'flat' расширилось бы до string и сломало вывод).
    const failures: string[] = [];
    const safe = async <T>(
      label: string,
      fn: () => Promise<T>,
      fallback: NoInfer<T>,
    ): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        failures.push(label);
        this.logger.error(
          `director widget «${label}» fail (tenantId=${args.tenantId}, period=${args.period}): ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
        return fallback;
      }
    };

    const [
      newThemes,
      newSignals,
      signalCounters,
      activeThemes,
      hotEntities,
      openQuestions,
      strategicAlignment,
      goalsTree,
      goalsPulse,
      sentimentRes,
      commitRes,
      hangingRes,
      valueStrip,
      mainReworkEnabled,
    ] = await Promise.all([
      safe('newThemes', () => this.fetchNewThemes(args.tenantId, since), []),
      safe('newSignals', () => this.fetchNewSignals(args.tenantId, since), []),
      safe(
        'signalCounters',
        () => this.fetchSignalCounters(args.tenantId, since),
        {
          pain: 0,
          feature_request: 0,
          churn_risk: 0,
          objection: 0,
          risk: 0,
          decision: 0,
          commitment: 0,
          other: 0,
        },
      ),
      safe('activeThemes', () => this.fetchActiveThemes(args.tenantId), []),
      safe('hotEntities', () => this.fetchHotEntities(args.tenantId, since), []),
      safe('openQuestions', () => this.fetchOpenQuestions(args.tenantId), []),
      safe(
        'strategicAlignment',
        () => this.fetchStrategicAlignment(args.tenantId),
        { average: null, goalsCount: 0, alertGoals: [] },
      ),
      safe('goalsTree', () => this.fetchGoalsTree(args.tenantId), []),
      safe(
        'goalsPulse',
        () => this.fetchGoalsPulse(args.tenantId),
        {
          onTrackCount: 0,
          atRiskCount: 0,
          stalledCount: 0,
          achievedCount: 0,
          droppedCount: 0,
          total: 0,
        },
      ),
      safe(
        'sentiment',
        () => this.sentimentSvc.getIndex({ tenantId: args.tenantId }),
        { value: 0, trend: 'flat', sparkline12w: [], totalCheckIns: 0, days: 7 },
      ),
      safe(
        'commitment',
        () =>
          this.commitSvc.getReliability({
            tenantId: args.tenantId,
            scope: 'company',
          }),
        {
          scope: 'company',
          scopeId: null,
          windowDays: 14,
          kept: 0,
          broken: 0,
          overdue: 0,
          pendingActive: 0,
          reliabilityPercent: 0,
          reliabilityLowData: true,
          delta14d: null,
          sparkline12w: [],
        },
      ),
      safe(
        'hangingDecisions',
        () => this.hangingSvc.count({ tenantId: args.tenantId }),
        { count: 0, minAgeDays: 7, minRaisedCount: 2, sparkline12w: [] },
      ),
      // ТЗ-2 Ф1 — «Полоса пользы» (всегда считается, в т.ч. для пустого tenant'а).
      safe(
        'valueStrip',
        () => this.fetchValueStrip(args.tenantId, args.period),
        {
          meetingsProtocoled: 0,
          tasksExtracted: 0,
          decisionsExtracted: 0,
          questionsAnsweredByMemory: 0,
          commitmentsKept: 0,
        },
      ),
      // ТЗ-2 Ф1 — kill-switch новой компоновки главной (default ON).
      safe(
        'mainReworkEnabled',
        () =>
          this.config.getDynamic<boolean>(
            'dashboard.main_rework.enabled',
            undefined,
            true,
          ),
        true,
      ),
    ]);

    // ТЗ-2 Ф1 — метрики отдачи: каждый собранный «Полосы пользы» + размер
    // первого экрана новой компоновки (7 величин). tenant_top — cardinality-safe.
    const tenantTop = tenantTopOf(args.tenantId);
    this.metrics.incDashboardValueStripServed({ tenantTop });
    this.metrics.setDashboardMainFirstScreenWidgetCount({
      tenantTop,
      count: 7,
    });

    // Pulse Wave 1 §1.5 — три KPI-hero для главной.
    const kpiSentimentIndex: DirectorDashboardKpiDto = {
      value: sentimentRes.value,
      sparkline: sentimentRes.sparkline12w,
      delta: null,
      trend: sentimentRes.trend,
    };
    const kpiCommitmentReliability: DirectorDashboardKpiDto = {
      value: commitRes.reliabilityPercent,
      sparkline: commitRes.sparkline12w,
      delta: commitRes.delta14d,
    };
    const kpiHangingDecisions: DirectorDashboardKpiDto = {
      value: hangingRes.count,
      sparkline: hangingRes.sparkline12w,
      delta: null,
    };

    // Sample story для пустых tenant'ов (ТЗ §1.2 принцип 4). Если у tenant'а
    // 0 сигналов и 0 тем за период — подменяем массивы на синтетический
    // пример и используем статичный narrative вместо LLM. Frontend рисует
    // watermark «образец».
    const totalSignals =
      signalCounters.pain +
      signalCounters.feature_request +
      signalCounters.churn_risk +
      signalCounters.objection +
      signalCounters.risk +
      signalCounters.decision +
      signalCounters.commitment +
      signalCounters.other;
    const totalThemes = newThemes.length + activeThemes.length;
    // Если виджеты упали и деградировали до пустых fallback'ов — это НЕ «пустой
    // tenant». Не подменять реальные (частичные) данные синтетическим «образцом»:
    // показываем что есть + degraded=true.
    const isEmpty =
      failures.length === 0 && totalSignals === 0 && totalThemes === 0;

    if (isEmpty) {
      const sampleResult: DirectorDashboardDto = {
        period: args.period,
        generatedAt: new Date().toISOString(),
        newThemes: [...SAMPLE_STORY_DATASET.newThemes],
        newSignals: [...SAMPLE_STORY_DATASET.newSignals],
        signalCounters: { ...SAMPLE_STORY_DATASET.signalCounters },
        activeThemes: [...SAMPLE_STORY_DATASET.activeThemes],
        hotEntities: [...SAMPLE_STORY_DATASET.hotEntities],
        openQuestions: [...SAMPLE_STORY_DATASET.openQuestions],
        narrativeSummary: { text: SAMPLE_STORY_NARRATIVE, citations: [] },
        // Pulse Wave 1 §1.5 — синтетические оптимистичные KPI для пустого
        // tenant'а. Frontend всё равно подсветит баннер «образец».
        kpiSentimentIndex: {
          value: 42,
          sparkline: [25, 28, 30, 32, 35, 38, 38, 40, 41, 42, 42, 42],
          delta: null,
          trend: 'up',
        },
        kpiCommitmentReliability: {
          value: 82,
          sparkline: [70, 72, 75, 78, 79, 81, 80, 82, 83, 82, 82, 82],
          delta: 4,
        },
        kpiHangingDecisions: {
          value: 2,
          sparkline: [4, 3, 3, 2, 2, 3, 2, 2, 1, 2, 2, 2],
          delta: null,
        },
        strategicAlignment,
        requiresAction,
        goalsTree,
        goalsPulse,
        isEmpty: true,
        // ТЗ-2 Ф1 — реальные счётчики пользы за период (без подмены на sample;
        // у пустого tenant'а они закономерно нулевые / минимальные).
        valueStrip,
        mainReworkEnabled,
        degraded: failures.length > 0,
      };
      this.cache.setWithTtl(cacheKey, sampleResult, DASHBOARD_TTL_MS);
      return sampleResult;
    }

    const narrativeSummary = await this.getNarrativeSummary({
      tenantId: args.tenantId,
      period: args.period,
      newThemes,
      activeThemes,
      newSignals,
      signalCounters,
      hotEntities,
      openQuestions,
    });

    const result: DirectorDashboardDto = {
      period: args.period,
      generatedAt: new Date().toISOString(),
      newThemes,
      newSignals,
      signalCounters,
      activeThemes,
      hotEntities,
      openQuestions,
      narrativeSummary,
      kpiSentimentIndex,
      kpiCommitmentReliability,
      kpiHangingDecisions,
      strategicAlignment,
      requiresAction,
      goalsTree,
      goalsPulse,
      isEmpty: false,
      // ТЗ-2 Ф1 — «Полоса пользы» + флаг новой компоновки.
      valueStrip,
      mainReworkEnabled,
      degraded: failures.length > 0,
    };

    this.cache.setWithTtl(cacheKey, result, DASHBOARD_TTL_MS);
    return result;
  }

  /**
   * Cron — раз в сутки в 06:00 сбрасывает все narrative-ключи.
   * Виджет-кэш (60s TTL) сбрасывать не нужно — он сам истекает.
   */
  @Cron('0 6 * * *')
  invalidateNarrativeCron(): void {
    this.logger.debug('Cron 06:00 — сбрасываем кэш narrative-сводок дашборда');
    this.cache.invalidate(NARRATIVE_CACHE_PREFIX);
  }

  // ─────────────────────────── narrative summary ───────────────────────────

  /**
   * Получить «Главное за неделю/месяц» через `LlmRouterService.call({taskType:
   * 'dashboard-summary', ...})`. На любую ошибку LLM — возвращает `null`
   * (UI скрывает блок, см. ТЗ §«Архитектурные решения» #5).
   *
   * Кэш — отдельный, ключ `dashboard:director:narrative:${tenantId}:${period}`,
   * TTL 24 часа. Сброс — раз в сутки cron'ом `invalidateNarrativeCron`.
   * Виджет-кэш (60s) и narrative-кэш живут независимо: первый перезапросит
   * виджеты из БД через минуту, второй — переиспользует текущую сводку
   * до 06:00 следующего дня.
   */
  private async getNarrativeSummary(args: {
    tenantId: string;
    period: 'week' | 'month';
    newThemes: DirectorDashboardThemeDto[];
    activeThemes: DirectorDashboardThemeDto[];
    newSignals: DirectorDashboardSignalDto[];
    signalCounters: DirectorDashboardSignalCountersDto;
    hotEntities: DirectorDashboardEntityDto[];
    openQuestions: DirectorDashboardOpenQuestionDto[];
  }): Promise<NarrativeSummaryDto | null> {
    const cacheKey = `${NARRATIVE_CACHE_PREFIX}${args.tenantId}:${args.period}`;
    const cached = this.cache.get<NarrativeSummaryDto>(cacheKey);
    if (cached !== null) return cached;

    // Если данных совсем нет — нечего и просить LLM.
    const totalSignals =
      args.signalCounters.pain +
      args.signalCounters.feature_request +
      args.signalCounters.churn_risk +
      args.signalCounters.objection +
      args.signalCounters.risk +
      args.signalCounters.decision +
      args.signalCounters.commitment +
      args.signalCounters.other;
    const totalThemes = args.newThemes.length + args.activeThemes.length;
    if (totalSignals === 0 && totalThemes === 0) {
      return null;
    }

    const userMessage = buildDashboardSummaryUserMessage({
      period: args.period,
      newThemes: args.newThemes,
      activeThemes: args.activeThemes,
      newSignals: args.newSignals,
      signalCounters: args.signalCounters,
      hotEntities: args.hotEntities,
      openQuestions: args.openQuestions,
    });

    try {
      const out = await this.llm.call({
        taskType: 'dashboard-summary',
        tenantId: args.tenantId,
        systemPrompt: DASHBOARD_SUMMARY_SYSTEM_PROMPT,
        userMessage,
        sourceRef: { type: 'dashboard', id: args.tenantId },
        // ТЗ 2026-05-25 LLM-architecture §10.4 Find 1 — 600 → 4000.
        // Текст нарратива 200-500 слов + резерв на thinking при переключении
        // primary на Pro.
        maxTokens: 4_000,
      });
      const text = (out.text ?? '').trim();
      if (text.length === 0) {
        return null;
      }

      // Собираем список валидных источников (то же, что отдали в USER).
      const sources: CitationSource[] = [];
      for (const t of [...args.newThemes, ...args.activeThemes].slice(0, 6)) {
        sources.push({ type: 'theme', id: t.id, label: t.name });
      }
      for (const s of args.newSignals.slice(0, 5)) {
        sources.push({ type: 'ib', id: s.id, label: s.name });
        if (s.evidenceMeetingId) {
          sources.push({
            type: 'mtg',
            id: s.evidenceMeetingId,
            label: `Встреча: ${s.name}`,
          });
        }
      }
      for (const e of args.hotEntities.slice(0, 3)) {
        sources.push({ type: 'ent', id: e.id, label: e.canonicalName });
      }
      for (const q of args.openQuestions.slice(0, 3)) {
        sources.push({ type: 'ib', id: q.id, label: q.criticalQuestion });
      }

      const parsed = this.citations.parse(text, sources);
      this.cache.setWithTtl(cacheKey, parsed, NARRATIVE_TTL_MS);
      return parsed;
    } catch (err) {
      this.logger.warn(
        `narrativeSummary fail (tenantId=${args.tenantId}, period=${args.period}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ──────────────────────── requires action (B2) ───────────────────────────

  /**
   * Action Center B2 — сводка pending-подтверждений текущего пользователя.
   * Best-effort: на любую ошибку PendingActionsService возвращает нулевую
   * сводку, чтобы не валить дашборд. Frontend при total=0 плитку не рисует.
   */
  private async fetchRequiresAction(
    tenantId: string,
    userId: string,
  ): Promise<DirectorDashboardRequiresActionDto> {
    try {
      const res = await this.pendingActions.getCount({ tenantId, userId });
      return {
        total: res.total,
        bySource: {
          curation: res.bySource.curation,
          conflict: res.bySource.conflict,
          intake: res.bySource.intake,
          probe: res.bySource.probe,
        },
      };
    } catch (err) {
      this.logger.warn(
        `requiresAction fail (tenantId=${tenantId}, userId=${userId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        total: 0,
        bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
      };
    }
  }

  // ─────────────────────────── widgets ──────────────────────────────────────

  private async fetchNewThemes(
    tenantId: string,
    since: Date,
  ): Promise<DirectorDashboardThemeDto[]> {
    const rows = await this.prisma.theme.findMany({
      where: {
        tenantId,
        status: 'active',
        createdAt: { gte: since },
      },
      orderBy: [
        { weight: 'desc' },
        { lastSignalAt: 'desc' },
      ],
      take: 10,
      select: {
        id: true,
        name: true,
        branch: true,
        weight: true,
        dynamic: true,
        _count: { select: { blocks: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      branch: r.branch ?? null,
      weight: this.decimalToNumber(r.weight),
      dynamic: r.dynamic,
      blocksCount: r._count.blocks,
      lastSignalAt: null,
    }));
  }

  private async fetchActiveThemes(
    tenantId: string,
  ): Promise<DirectorDashboardThemeDto[]> {
    const rows = await this.prisma.theme.findMany({
      where: {
        tenantId,
        status: 'active',
        dynamic: 'growing',
      },
      orderBy: [
        { weight: 'desc' },
        { lastSignalAt: 'desc' },
      ],
      take: 10,
      select: {
        id: true,
        name: true,
        branch: true,
        weight: true,
        dynamic: true,
        lastSignalAt: true,
        _count: { select: { blocks: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      branch: r.branch ?? null,
      weight: this.decimalToNumber(r.weight),
      dynamic: r.dynamic,
      blocksCount: r._count.blocks,
      lastSignalAt: r.lastSignalAt ? r.lastSignalAt.toISOString() : null,
    }));
  }

  private async fetchNewSignals(
    tenantId: string,
    since: Date,
  ): Promise<DirectorDashboardSignalDto[]> {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        createdAt: { gte: since },
        signalType: { in: SIGNAL_TYPES_FOR_NEW_SIGNALS },
      },
      orderBy: [
        { confidence: 'desc' },
        { dynamicScore: 'desc' },
      ],
      take: 10,
      select: {
        id: true,
        name: true,
        signalType: true,
        confidence: true,
        criticalQuestion: true,
        trustedAnswer: true,
        evidence: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: {
            sourceType: true,
            rawEvent: { select: { sourceExternalId: true, sourceType: true } },
          },
        },
      },
    });
    // ТЗ-2 Ф1 — резолв `reasonSourceRef`: для сигналов, чьё первое evidence
    // ссылается на встречу, подтягиваем заголовок встречи batch'ем (одним
    // findMany, без N+1).
    const meetingIds = new Set<string>();
    for (const r of rows) {
      const firstEv = r.evidence[0];
      if (
        firstEv &&
        firstEv.rawEvent.sourceType === 'meeting' &&
        firstEv.rawEvent.sourceExternalId
      ) {
        meetingIds.add(firstEv.rawEvent.sourceExternalId);
      }
    }
    const titleById = new Map<string, string>();
    if (meetingIds.size > 0) {
      const meetings = await this.prisma.meeting.findMany({
        where: { tenantId, id: { in: [...meetingIds] } },
        select: { id: true, title: true },
      });
      for (const m of meetings) {
        titleById.set(m.id, m.title);
      }
    }

    return rows.map((r) => {
      const firstEv = r.evidence[0];
      const evidenceMeetingId =
        firstEv && firstEv.rawEvent.sourceType === 'meeting'
          ? firstEv.rawEvent.sourceExternalId ?? null
          : null;
      // reasonSourceRef: встреча → {meetingId, meetingTitle}; иначе null.
      // (Модель evidence не несёт прямой ссылки на Decision — ветка
      // `{ decisionId }` зарезервирована в DTO под будущий источник-решение.)
      const reasonSourceRef: DirectorDashboardSignalDto['reasonSourceRef'] =
        evidenceMeetingId
          ? {
              meetingId: evidenceMeetingId,
              meetingTitle: titleById.get(evidenceMeetingId) ?? undefined,
            }
          : null;
      return {
        id: r.id,
        name: r.name,
        signalType: r.signalType,
        confidence: this.decimalToNumber(r.confidence),
        criticalQuestion: r.criticalQuestion,
        trustedAnswer: this.truncate(r.trustedAnswer, TRUSTED_ANSWER_TRUNCATE),
        evidenceMeetingId,
        reasonSourceRef,
      };
    });
  }

  private async fetchSignalCounters(
    tenantId: string,
    since: Date,
  ): Promise<DirectorDashboardSignalCountersDto> {
    const rows = await this.prisma.ideaBlock.groupBy({
      by: ['signalType'],
      where: {
        tenantId,
        status: 'canonical',
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    const counters: DirectorDashboardSignalCountersDto = {
      pain: 0,
      feature_request: 0,
      churn_risk: 0,
      objection: 0,
      risk: 0,
      decision: 0,
      commitment: 0,
      other: 0,
    };

    for (const row of rows) {
      const cnt = row._count._all;
      switch (row.signalType) {
        case 'pain':
          counters.pain += cnt;
          break;
        case 'feature_request':
          counters.feature_request += cnt;
          break;
        case 'churn_risk':
          counters.churn_risk += cnt;
          break;
        case 'objection':
          counters.objection += cnt;
          break;
        case 'risk':
          counters.risk += cnt;
          break;
        case 'decision':
          counters.decision += cnt;
          break;
        case 'commitment':
          counters.commitment += cnt;
          break;
        default:
          // mood / drift / competitor_move / metric_change / idea / fact / knowledge_gap
          // + SBA α-2: reasoning / rationale / decision_basis / regulation / process_step
          counters.other += cnt;
      }
    }
    return counters;
  }

  /**
   * Топ-10 сущностей по числу упоминаний в canonical-блоках за период.
   * RAW SQL для гибкого groupBy + DISTINCT по blockId (один блок может упоминать
   * сущность несколько раз через IdeaBlockEntity, но мы считаем отдельные блоки).
   * Исключаем merged (mergedIntoId IS NULL).
   */
  private async fetchHotEntities(
    tenantId: string,
    since: Date,
  ): Promise<DirectorDashboardEntityDto[]> {
    interface HotEntityRow {
      id: string;
      canonicalName: string;
      type: string;
      recentMentions: bigint;
    }
    const rows = await this.prisma.$queryRaw<HotEntityRow[]>`
      SELECT e.id, e."canonicalName", e.type::text AS type,
             COUNT(DISTINCT bm."blockId")::bigint AS "recentMentions"
      FROM "Entity" e
      JOIN "IdeaBlockEntity" bm ON bm."entityId" = e.id
      JOIN "IdeaBlock" b ON b.id = bm."blockId"
      WHERE e."tenantId" = ${tenantId}
        AND e."mergedIntoId" IS NULL
        AND b."tenantId" = ${tenantId}
        AND b.status = 'canonical'
        AND b."createdAt" >= ${since}
      GROUP BY e.id, e."canonicalName", e.type
      ORDER BY "recentMentions" DESC
      LIMIT 10
    `;
    return rows.map((r) => ({
      id: r.id,
      canonicalName: r.canonicalName,
      type: r.type,
      recentMentions: Number(r.recentMentions),
    }));
  }

  private async fetchOpenQuestions(
    tenantId: string,
  ): Promise<DirectorDashboardOpenQuestionDto[]> {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        signalType: 'knowledge_gap',
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      criticalQuestion: r.criticalQuestion,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * ТЗ-2 Ф1 — «Полоса пользы» (Value Strip): 5 твёрдых счётчиков за период.
   * Окно (`since`) — то же, что у остальных fetch*-методов (см. `calcSince`).
   *
   *   - `meetingsProtocoled`        — `Meeting` tenant'а в окне с готовым AI-отчётом
   *                                   (через relation `aiResult`: summaryFast OR
   *                                   summary заполнены);
   *   - `tasksExtracted`            — `Task` tenant'а, созданные в окне;
   *   - `decisionsExtracted`        — `Decision` tenant'а, созданные в окне;
   *   - `questionsAnsweredByMemory` — assistant-сообщения `ChatV2Message` с непустым
   *                                   citations-массивом (та же техника, что у
   *                                   `ChatV2FeedbackService.getChatUsageStats`:
   *                                   jsonb_typeof='array' AND jsonb_array_length>0);
   *   - `commitmentsKept`           — `IdeaBlock` signalType='commitment' AND
   *                                   commitmentStatus='fulfilled', созданные в окне.
   */
  private async fetchValueStrip(
    tenantId: string,
    period: 'week' | 'month',
  ): Promise<DirectorDashboardValueStripDto> {
    const since = this.calcSince(period);

    type CountRow = { cnt: bigint | number };

    const [
      meetingsProtocoled,
      tasksExtracted,
      decisionsExtracted,
      questionsRows,
      commitmentsKept,
    ] = await Promise.all([
      // Встречи с готовым AI-отчётом: aiResult.summaryFast OR summary заполнены.
      // createdAt в окне. (v2-ветка analyzeV2Status удалена 2026-06-10 — мёртвый
      // стек; колонка осталась в БД, но больше не участвует в подсчёте.)
      this.prisma.meeting.count({
        where: {
          tenantId,
          createdAt: { gte: since },
          OR: [
            { aiResult: { is: { summaryFast: { not: null } } } },
            { aiResult: { is: { summary: { not: '' } } } },
          ],
        },
      }),
      this.prisma.task.count({
        where: { tenantId, createdAt: { gte: since } },
      }),
      this.prisma.decision.count({
        where: { tenantId, createdAt: { gte: since } },
      }),
      // Ответы AI-чата с привязкой к источнику — та же техника, что в
      // ChatV2FeedbackService.getChatUsageStats (jsonb-type-guard массива
      // citations). ChatV2Message не несёт tenantId напрямую — join к
      // ChatV2Conversation.
      this.prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS cnt
        FROM "ChatV2Message" m
        JOIN "ChatV2Conversation" c ON c."id" = m."conversationId"
        WHERE c."tenantId" = ${tenantId}
          AND m."role" = 'assistant'
          AND m."createdAt" >= ${since}
          AND m."citations" IS NOT NULL
          AND jsonb_typeof(m."citations") = 'array'
          AND jsonb_array_length(m."citations") > 0
      `,
      this.prisma.ideaBlock.count({
        where: {
          tenantId,
          signalType: 'commitment',
          commitmentStatus: 'fulfilled',
          createdAt: { gte: since },
        },
      }),
    ]);

    const questionsAnsweredByMemory = Number(questionsRows[0]?.cnt ?? 0);

    return {
      meetingsProtocoled,
      tasksExtracted,
      decisionsExtracted,
      questionsAnsweredByMemory,
      commitmentsKept,
    };
  }

  /**
   * Phase 9: блок «Согласованность стратегии».
   *
   * Загружает все активные не-archived `Goal[]` Org. Считает взвешенное
   * среднее `cachedAlignment` по `weight`. `alertGoals` — цели с резким
   * падением (`cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`).
   *
   * Если у Org нет активных целей — `goalsCount=0, average=null, alertGoals=[]`.
   * Если есть, но никто ещё не считался — `average=null`.
   */
  private async fetchStrategicAlignment(
    tenantId: string,
  ): Promise<DirectorDashboardStrategicAlignmentDto> {
    const goals = await this.prisma.goal.findMany({
      where: {
        tenantId,
        status: 'active',
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        weight: true,
        cachedAlignment: true,
        cachedAlignmentDelta: true,
      },
    });

    const goalsCount = goals.length;
    if (goalsCount === 0) {
      return { average: null, goalsCount: 0, alertGoals: [] };
    }

    let weightedSum = 0;
    let weightTotal = 0;
    const alertGoals: DirectorDashboardAlertGoalDto[] = [];

    for (const g of goals) {
      const w = this.decimalToNumber(g.weight);
      if (g.cachedAlignment !== null && Number.isFinite(w) && w > 0) {
        weightedSum += w * g.cachedAlignment;
        weightTotal += w;
      }
      if (
        g.cachedAlignment !== null &&
        g.cachedAlignmentDelta !== null &&
        g.cachedAlignmentDelta <= -15 &&
        g.cachedAlignment <= 60
      ) {
        alertGoals.push({
          id: g.id,
          name: g.name,
          score: g.cachedAlignment,
          delta: g.cachedAlignmentDelta,
        });
      }
    }

    const average =
      weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

    return { average, goalsCount, alertGoals };
  }

  /**
   * Goals OKR v2 Фаза 4 — дерево active-целей с KR-прогрессом и progressStatus.
   *
   * Берём active+живые цели (`status='active'`, `promotionState='active'`,
   * `validUntil=null`, `archivedAt=null`) с их KR. Строим дерево
   * parent→children: корни — цели с `parentGoalId=null` ИЛИ чей родитель не
   * входит в активный набор (сирота → корень).
   */
  private async fetchGoalsTree(
    tenantId: string,
  ): Promise<DirectorDashboardGoalTreeNodeDto[]> {
    const goals = await this.prisma.goal.findMany({
      where: {
        tenantId,
        status: 'active',
        promotionState: 'active',
        validUntil: null,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        progressStatus: true,
        cachedAlignment: true,
        weight: true,
        parentGoalId: true,
        keyResults: {
          select: {
            id: true,
            name: true,
            unit: true,
            startValue: true,
            targetValue: true,
            currentValue: true,
          },
        },
      },
    });

    // Узлы по id (без children — заполним вторым проходом).
    const nodeById = new Map<string, DirectorDashboardGoalTreeNodeDto>();
    for (const g of goals) {
      nodeById.set(g.id, {
        id: g.id,
        name: g.name,
        status: g.status,
        progressStatus: g.progressStatus,
        cachedAlignment: g.cachedAlignment ?? null,
        weight: this.decimalToNumber(g.weight),
        parentGoalId: g.parentGoalId,
        keyResults: g.keyResults.map((kr) => ({
          id: kr.id,
          name: kr.name,
          unit: kr.unit ?? null,
          progressPercent: this.krProgressPercent(
            this.decimalToNumber(kr.startValue),
            this.decimalToNumber(kr.targetValue),
            this.decimalToNumber(kr.currentValue),
          ),
        })),
        children: [],
      });
    }

    // Сборка дерева: цель с родителем в наборе → ребёнок; иначе корень.
    const roots: DirectorDashboardGoalTreeNodeDto[] = [];
    for (const node of nodeById.values()) {
      const parent =
        node.parentGoalId !== null ? nodeById.get(node.parentGoalId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Goals OKR v2 Фаза 4 — счётчики недели по progressStatus для виджета
   * «Пульс целей». Active+живые цели Org.
   */
  private async fetchGoalsPulse(
    tenantId: string,
  ): Promise<DirectorDashboardGoalsPulseDto> {
    const rows = await this.prisma.goal.groupBy({
      by: ['progressStatus'],
      where: {
        tenantId,
        status: 'active',
        promotionState: 'active',
        validUntil: null,
        archivedAt: null,
      },
      _count: { _all: true },
    });

    const pulse: DirectorDashboardGoalsPulseDto = {
      onTrackCount: 0,
      atRiskCount: 0,
      stalledCount: 0,
      achievedCount: 0,
      droppedCount: 0,
      total: 0,
    };
    for (const r of rows) {
      const n = r._count._all;
      pulse.total += n;
      switch (r.progressStatus) {
        case 'on_track':
          pulse.onTrackCount += n;
          break;
        case 'at_risk':
          pulse.atRiskCount += n;
          break;
        case 'stalled':
          pulse.stalledCount += n;
          break;
        case 'achieved':
          pulse.achievedCount += n;
          break;
        case 'dropped':
          pulse.droppedCount += n;
          break;
        default:
          break;
      }
    }
    return pulse;
  }

  // ─────────────────────────── helpers ──────────────────────────────────────

  /** Прогресс KR в %: clamp 0..100, защита от деления на 0 (target==start → 0). */
  private krProgressPercent(
    start: number,
    target: number,
    current: number,
  ): number {
    const span = target - start;
    if (span === 0) return 0;
    const pct = ((current - start) / span) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }

  private calcSince(period: 'week' | 'month'): Date {
    const since = new Date();
    if (period === 'week') {
      since.setUTCDate(since.getUTCDate() - 7);
    } else {
      since.setUTCDate(since.getUTCDate() - 30);
    }
    return since;
  }

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  private decimalToNumber(v: unknown): number {
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
}
