import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ChatV2FeedbackService } from '../../chat-v2/services/chat-v2-feedback.service';
// Чистая функция «мало данных» — импорт из dashboard-сервиса НЕ создаёт
// зависимости модуля (берём только helper, не сам Injectable).
import { reliabilityOrLowData } from '../../dashboard/services/commitment-reliability.service';
import {
  buildValueRecapFallbackNarrative,
  buildValueRecapNarrativeUserMessage,
  VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT,
  VALUE_RECAP_NARRATIVE_TASK_TYPE,
  type ValueRecapNarrativePromptInput,
} from '../prompts/value-recap-narrative.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { DecisionImplementationService } from './decision-implementation.service';
import {
  assembleValueRecapPayload,
  type ValueRecapPayload,
  type ValueRecapRoutine,
  type ValueRecapTeam,
} from './value-recap.scoring';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — ValueRecapService.
 *
 * Месячный агрегатор «что Кора сделала за месяц» (витрина владельцу). Ведущая
 * ось — твёрдые счётчики «снятой рутины» (из БД); второй слой — soft-цифры
 * «команда лучше» (с «оценка» + знаменателем). Дельта к прошлому месяцу.
 * baseline = первый снимок (без атрибуции продукту без контрольной группы).
 *
 * Честность (Р6/Р7) гарантируется кодом: `assembleValueRecapPayload` вызывает
 * `assertNoForbiddenMetricKeys` (₽/часы×ставка, было→стало, medianHoursToAnswer,
 * roiScore/alignment как KPI — запрещены). LLM — ТОЛЬКО на narrative поверх
 * посчитанных цифр (с детерминированным fallback).
 *
 * Переиспользует `getDecisionThroughput` (Ф3.B) и `getChatUsageStats` (Ф5
 * chat-feedback) — не дублирует логику.
 */
@Injectable()
export class ValueRecapService {
  private readonly logger = new Logger(ValueRecapService.name);

  /** Code-fallback для `reliability.min_denominator` (как в dashboard). */
  private static readonly DEFAULT_MIN_DENOMINATOR = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ChatV2FeedbackService)
    private readonly chatFeedback: ChatV2FeedbackService,
    @Inject(DecisionImplementationService)
    private readonly decisions: DecisionImplementationService,
  ) {}

  // ──────────────────────────── build (cron / read) ───────────────────

  /**
   * Построить (или пересобрать) месячный value-recap. Идемпотентно — upsert по
   * (tenantId, periodYm). Возвращает snapshot + payload.
   *
   * @param periodYm YYYY-MM месяца отчёта.
   */
  async build(args: {
    tenantId: string;
    periodYm: string;
    now?: Date;
  }): Promise<{ id: string; payload: ValueRecapPayload; alreadyDelivered: boolean }> {
    const now = args.now ?? new Date();
    const { from, to } = monthBounds(args.periodYm);

    // 1. Твёрдые счётчики «снятой рутины» (из БД, без LLM).
    const routine = await this.computeRoutine(args.tenantId, from, to);

    // 2. Soft-слой «команда лучше» (оценка + знаменатель).
    const team = await this.computeTeam({ tenantId: args.tenantId, from, to });

    // 3. Прошлый месяц — для дельты (baseline → null).
    const prevPeriod = shiftPeriod(args.periodYm, -1);
    const previousRoutine = await this.loadPreviousRoutine(
      args.tenantId,
      prevPeriod,
    );

    // 4. Narrative (LLM поверх цифр, с детерминированным fallback).
    const promptInput = this.buildPromptInput({
      periodYm: args.periodYm,
      routine,
      team,
      previousRoutine,
    });
    const narrative = await this.buildNarrative(args.tenantId, promptInput);

    // 5. Сборка payload (assert честности — внутри).
    const payload = assembleValueRecapPayload({
      periodYm: args.periodYm,
      builtAt: now,
      routine,
      team,
      previousRoutine,
      narrative,
    });

    // 6. Upsert снимка (идемпотентно).
    const existing = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
      select: { id: true, deliveredAt: true },
    });
    const row = await this.prisma.valueRecapSnapshot.upsert({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
      create: {
        tenantId: args.tenantId,
        periodYm: args.periodYm,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
      update: {
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        // deliveredAt/openedAt НЕ сбрасываем (доставка идемпотентна).
      },
      select: { id: true },
    });

    this.metrics.incValueRecapBuilt();
    this.logger.log(
      {
        tenantId: args.tenantId,
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        periodYm: args.periodYm,
        isBaseline: payload.isBaseline,
      },
      'value-recap: build завершён',
    );

    return {
      id: row.id,
      payload,
      alreadyDelivered: existing?.deliveredAt != null,
    };
  }

  /** Прочитать готовый снимок (для эндпоинта). */
  async getSnapshot(args: {
    tenantId: string;
    periodYm: string;
  }): Promise<{
    id: string;
    periodYm: string;
    payload: ValueRecapPayload | null;
    deliveredAt: string | null;
    openedAt: string | null;
    createdAt: string;
  } | null> {
    const row = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      periodYm: row.periodYm,
      payload: parsePayload(row.payloadJson),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Прочитать снимок по id (для opened/export, scope по tenantId). */
  async getById(args: {
    tenantId: string;
    id: string;
  }): Promise<{
    id: string;
    periodYm: string;
    payload: ValueRecapPayload | null;
    deliveredAt: string | null;
    openedAt: string | null;
    createdAt: string;
  } | null> {
    const row = await this.prisma.valueRecapSnapshot.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) return null;
    return {
      id: row.id,
      periodYm: row.periodYm,
      payload: parsePayload(row.payloadJson),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Пометить снимок открытым (idempotent — ставит openedAt один раз). */
  async markOpened(args: { tenantId: string; id: string }): Promise<boolean> {
    const row = await this.prisma.valueRecapSnapshot.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true, openedAt: true },
    });
    if (!row) return false;
    if (row.openedAt) return true; // уже открыт — не плодим метрику
    await this.prisma.valueRecapSnapshot.update({
      where: { id: row.id },
      data: { openedAt: new Date() },
    });
    this.metrics.incValueRecapOpened();
    return true;
  }

  /** Пометить снимок доставленным (push-first). */
  async markDelivered(id: string): Promise<void> {
    await this.prisma.valueRecapSnapshot.update({
      where: { id },
      data: { deliveredAt: new Date() },
    });
  }

  // ──────────────────────────── compute parts ─────────────────────────

  /** Твёрдые счётчики «снятой рутины» за окно (из БД, без LLM). */
  private async computeRoutine(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<ValueRecapRoutine> {
    const [
      meetingsAutoProtocoled,
      tasksExtracted,
      decisionsExtracted,
      commitmentsExtracted,
      statusesCollected,
      ideasShipped,
    ] = await Promise.all([
      // Встреча запротоколирована авто = есть AiResult, у Meeting той же Org,
      // созданная в окне. Считаем через AiResult.meeting (надёжнее, чем
      // nullable AiResult.tenantId).
      this.prisma.aiResult.count({
        where: {
          meeting: { tenantId, createdAt: { gte: from, lte: to } },
        },
      }),
      this.prisma.task.count({
        where: { tenantId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.decision.count({
        where: { tenantId, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.ideaBlock.count({
        where: {
          tenantId,
          signalType: 'commitment',
          createdAt: { gte: from, lte: to },
        },
      }),
      // Статусов собрано = завершённые чек-ины (человек ответил) в окне.
      this.prisma.dailyCheckIn.count({
        where: {
          tenantId,
          completedAt: { gte: from, lte: to, not: null },
        },
      }),
      this.prisma.idea.count({
        where: {
          tenantId,
          status: 'shipped',
          // shipped в окне — по statusChangedAt (когда довели), fallback updatedAt.
          OR: [
            { statusChangedAt: { gte: from, lte: to } },
            { statusChangedAt: null, updatedAt: { gte: from, lte: to } },
          ],
        },
      }),
    ]);

    // Вопросов отвечено памятью с привязкой к источнику — grounding-proxy из
    // агрегатора чата (org-scope). Переиспользуем getChatUsageStats (Ф5).
    const chat = await this.chatFeedback.getChatUsageStats({
      tenantId,
      from,
      to,
      scope: 'org',
    });

    return {
      meetingsAutoProtocoled: nz(meetingsAutoProtocoled),
      tasksExtracted: nz(tasksExtracted),
      decisionsExtracted: nz(decisionsExtracted),
      commitmentsExtracted: nz(commitmentsExtracted),
      statusesCollected: nz(statusesCollected),
      questionsAnsweredWithCitation: chat.answeredWithCitation,
      ideasShipped: nz(ideasShipped),
    };
  }

  /** Soft-слой «команда лучше» (оценка + знаменатель). */
  private async computeTeam(args: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<ValueRecapTeam> {
    const minDenom = await this.resolveMinDenominator();

    // Надёжность обещаний за месяц (по commitmentDueDate в окне).
    const reliability = await this.computeReliability({
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
      minDenom,
    });

    // helped-rate чата (org-scope, скрыт при rated<min внутри агрегатора).
    const chat = await this.chatFeedback.getChatUsageStats({
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
      scope: 'org',
    });

    // throughput решений (Ф3.B — count В ПАРЕ с %).
    const throughput = await this.decisions.getDecisionThroughput({
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
    });

    const ideasShipped = await this.prisma.idea.count({
      where: {
        tenantId: args.tenantId,
        status: 'shipped',
        OR: [
          { statusChangedAt: { gte: args.from, lte: args.to } },
          { statusChangedAt: null, updatedAt: { gte: args.from, lte: args.to } },
        ],
      },
    });

    return {
      reliabilityPercent: reliability.percent,
      reliabilityDenominator: reliability.denominator,
      reliabilityDelta: reliability.delta,
      chatHelpedRatePercent: chat.helpedRatePercent,
      chatRated: chat.rated,
      chatAnsweredWithCitation: chat.answeredWithCitation,
      decisionsTotal: throughput.total,
      decisionsThroughputPercent: throughput.throughputPercent,
      ideasShipped: nz(ideasShipped),
      estimate: true,
    };
  }

  /**
   * Надёжность обещаний за месяц: kept/(kept+broken+overdue), скрыта при малом
   * знаменателе. Дельта к предыдущему месяцу той же длины. Логика — как в
   * dashboard CommitmentReliabilityService, но локально (компания-scope) чтобы
   * не тянуть весь dashboard-модуль (избегаем circular dependency).
   */
  private async computeReliability(args: {
    tenantId: string;
    from: Date;
    to: Date;
    minDenom: number;
  }): Promise<{ percent: number | null; denominator: number; delta: number | null }> {
    const cur = await this.reliabilityWindow(args.tenantId, args.from, args.to);
    const curDenom = cur.kept + cur.broken + cur.overdue;
    const percent = reliabilityOrLowData(cur.kept, curDenom, args.minDenom);

    // Предыдущее окно той же длины.
    const lenMs = args.to.getTime() - args.from.getTime();
    const prevTo = new Date(args.from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - lenMs);
    const prev = await this.reliabilityWindow(args.tenantId, prevFrom, prevTo);
    const prevDenom = prev.kept + prev.broken + prev.overdue;
    const prevPercent = reliabilityOrLowData(prev.kept, prevDenom, args.minDenom);

    const delta =
      percent !== null && prevPercent !== null ? percent - prevPercent : null;

    return { percent, denominator: curDenom, delta };
  }

  private async reliabilityWindow(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{ kept: number; broken: number; overdue: number }> {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        commitmentDueDate: { gte: from, lte: to },
      },
      select: { commitmentStatus: true, commitmentDueDate: true },
      take: 50_000,
    });
    const now = new Date();
    let kept = 0;
    let broken = 0;
    let overdue = 0;
    for (const r of rows) {
      const status = r.commitmentStatus;
      if (status === 'fulfilled') kept++;
      else if (status === 'missed') broken++;
      else if (status === 'open' || status === 'asked') {
        if (r.commitmentDueDate && r.commitmentDueDate.getTime() < now.getTime()) {
          overdue++;
        }
      }
    }
    return { kept, broken, overdue };
  }

  /** Загрузить routine прошлого месяца из его снимка (для дельты). */
  private async loadPreviousRoutine(
    tenantId: string,
    prevPeriodYm: string,
  ): Promise<ValueRecapRoutine | null> {
    const prev = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId, periodYm: prevPeriodYm },
      },
      select: { payloadJson: true },
    });
    if (!prev) return null;
    const payload = parsePayload(prev.payloadJson);
    return payload?.routine ?? null;
  }

  // ──────────────────────────── narrative (LLM) ───────────────────────

  private buildPromptInput(args: {
    periodYm: string;
    routine: ValueRecapRoutine;
    team: ValueRecapTeam;
    previousRoutine: ValueRecapRoutine | null;
  }): ValueRecapNarrativePromptInput {
    const prev = args.previousRoutine;
    return {
      periodYm: args.periodYm,
      routine: {
        meetingsAutoProtocoled: args.routine.meetingsAutoProtocoled,
        tasksExtracted: args.routine.tasksExtracted,
        decisionsExtracted: args.routine.decisionsExtracted,
        commitmentsExtracted: args.routine.commitmentsExtracted,
        statusesCollected: args.routine.statusesCollected,
        questionsAnsweredWithCitation: args.routine.questionsAnsweredWithCitation,
        ideasShipped: args.routine.ideasShipped,
      },
      team: {
        reliabilityPercent: args.team.reliabilityPercent,
        reliabilityDenominator: args.team.reliabilityDenominator,
        chatHelpedRatePercent: args.team.chatHelpedRatePercent,
        chatRated: args.team.chatRated,
        decisionsThroughputPercent: args.team.decisionsThroughputPercent,
        decisionsTotal: args.team.decisionsTotal,
      },
      delta: prev
        ? {
            meetingsAutoProtocoled:
              args.routine.meetingsAutoProtocoled - prev.meetingsAutoProtocoled,
            tasksExtracted: args.routine.tasksExtracted - prev.tasksExtracted,
            decisionsExtracted:
              args.routine.decisionsExtracted - prev.decisionsExtracted,
          }
        : null,
    };
  }

  private async buildNarrative(
    tenantId: string,
    promptInput: ValueRecapNarrativePromptInput,
  ): Promise<string> {
    try {
      const result = await this.llm.call({
        taskType: VALUE_RECAP_NARRATIVE_TASK_TYPE,
        tenantId,
        systemPrompt: VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT,
        userMessage: buildValueRecapNarrativeUserMessage(promptInput),
        maxTokens: 400,
        sourceRef: { type: 'value-recap', id: tenantId },
      });
      const text = (result.text ?? '').trim();
      if (text.length > 0) return text.slice(0, 1_500);
      return buildValueRecapFallbackNarrative(promptInput);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'value-recap: LLM narrative упал — fallback',
      );
      return buildValueRecapFallbackNarrative(promptInput);
    }
  }

  // ──────────────────────────── helpers ───────────────────────────────

  private async resolveMinDenominator(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'reliability.min_denominator',
      'RELIABILITY_MIN_DENOMINATOR',
      ValueRecapService.DEFAULT_MIN_DENOMINATOR,
    );
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : ValueRecapService.DEFAULT_MIN_DENOMINATOR;
  }
}

/** Парс payload из JSON-колонки (защита от мусора). */
function parsePayload(raw: Prisma.JsonValue): ValueRecapPayload | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as unknown as ValueRecapPayload;
  }
  return null;
}

/** Границы месяца YYYY-MM в UTC: [first 00:00, last 23:59:59.999]. */
export function monthBounds(periodYm: string): { from: Date; to: Date } {
  const m = periodYm.match(/^(\d{4})-(\d{2})$/);
  const year = m ? Number(m[1]) : new Date().getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : new Date().getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { from, to };
}

/** Сдвиг YYYY-MM на N месяцев. */
export function shiftPeriod(periodYm: string, months: number): string {
  const m = periodYm.match(/^(\d{4})-(\d{2})$/);
  const year = m ? Number(m[1]) : new Date().getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : new Date().getUTCMonth();
  const d = new Date(Date.UTC(year, month + months, 1));
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mm}`;
}

function nz(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}
