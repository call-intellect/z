import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { SignalType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminCacheService } from '../../admin/services/admin-cache.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  DirectorDashboardAlertGoalDto,
  DirectorDashboardDto,
  DirectorDashboardEntityDto,
  DirectorDashboardGoalsPulseDto,
  DirectorDashboardGoalTreeNodeDto,
  DirectorDashboardKpiDto,
  DirectorDashboardOpenQuestionDto,
  DirectorDashboardSignalCountersDto,
  DirectorDashboardSignalDto,
  DirectorDashboardStrategicAlignmentDto,
  DirectorDashboardThemeDto,
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
  ) {}

  /**
   * Главный метод: возвращает срез знаний компании за период.
   * Кэш 60s по ключу (tenantId, period). На повторный запрос внутри окна —
   * не дёргает БД.
   */
  async getDirectorView(args: {
    tenantId: string;
    period: 'week' | 'month';
  }): Promise<DirectorDashboardDto> {
    const cacheKey = `dashboard:director:${args.tenantId}:${args.period}`;
    const cached = this.cache.get<DirectorDashboardDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const since = this.calcSince(args.period);

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
    ] = await Promise.all([
      this.fetchNewThemes(args.tenantId, since),
      this.fetchNewSignals(args.tenantId, since),
      this.fetchSignalCounters(args.tenantId, since),
      this.fetchActiveThemes(args.tenantId),
      this.fetchHotEntities(args.tenantId, since),
      this.fetchOpenQuestions(args.tenantId),
      this.fetchStrategicAlignment(args.tenantId),
      this.fetchGoalsTree(args.tenantId),
      this.fetchGoalsPulse(args.tenantId),
      this.sentimentSvc.getIndex({ tenantId: args.tenantId }),
      this.commitSvc.getReliability({
        tenantId: args.tenantId,
        scope: 'company',
      }),
      this.hangingSvc.count({ tenantId: args.tenantId }),
    ]);

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
    const isEmpty = totalSignals === 0 && totalThemes === 0;

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
        goalsTree,
        goalsPulse,
        isEmpty: true,
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
      goalsTree,
      goalsPulse,
      isEmpty: false,
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
    return rows.map((r) => {
      const firstEv = r.evidence[0];
      const evidenceMeetingId =
        firstEv && firstEv.rawEvent.sourceType === 'meeting'
          ? firstEv.rawEvent.sourceExternalId ?? null
          : null;
      return {
        id: r.id,
        name: r.name,
        signalType: r.signalType,
        confidence: this.decimalToNumber(r.confidence),
        criticalQuestion: r.criticalQuestion,
        trustedAnswer: this.truncate(r.trustedAnswer, TRUSTED_ANSWER_TRUNCATE),
        evidenceMeetingId,
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
