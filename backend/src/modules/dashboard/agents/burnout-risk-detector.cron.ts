import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 4 §4.5 — Burnout-Risk-Detector cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §4.5.
 *
 * Daily (`@Cron('45 3 * * *')`): для каждого employee Person с
 * `analyticsOptIn=true` (Wave 4.1 — 152-ФЗ gate) пересчитывает активные
 * risk-flag'и относительно личного baseline (90 дней).
 *
 * НЕ агрегирует в одну цифру — только список активных сигналов. Это снижает
 * ложные срабатывания и даёт руководителю конкретный «повод поговорить».
 *
 * Сигналы v1 (7 типов — все активны с ТЗ-1 Ф3.D.3):
 *   1. sentiment_dip        — green-share упал ≥0.2 от 14d vs 90d baseline.
 *   2. reply_latency_rise   — средняя задержка ответа (Notification.respondedAt
 *                             − createdAt) в 14d выросла в ≥factor раз vs 15-90d
 *                             baseline.
 *   3. missed_checkins      — <3 evening чек-инов за последние 7 дней.
 *   4. broken_promises      — ≥3 missed commitment'ов за 28 дней.
 *   5. workload_overload    — активный Appointment.loadPercent > порога.
 *   6. meeting_noshows      — ≥N неявок (invited, joinedAt=NULL) на завершённые
 *                             встречи за 28 дней.
 *   7. conflict_mentions    — ≥1 EntityLink('conflicted_with') за 14 дней.
 *
 * Best-effort: ошибка по одному Person'у не валит остальных.
 *
 * EU AI Act: это поведенческая аналитика на основе деятельности
 * (чек-ины / обещания / упоминания / нагрузка / явка), а не emotion recognition.
 *
 * Пороги триггеров 2/5/6 — AdminSetting (`probe.*`), без хардкода.
 */
@Injectable()
export class BurnoutRiskDetectorCron {
  private readonly logger = new Logger(BurnoutRiskDetectorCron.name);
  private static readonly WINDOW_7D_MS = 7 * 24 * 3600 * 1000;
  private static readonly WINDOW_14D_MS = 14 * 24 * 3600 * 1000;
  private static readonly WINDOW_28D_MS = 28 * 24 * 3600 * 1000;
  private static readonly WINDOW_90D_MS = 90 * 24 * 3600 * 1000;
  /** Code-fallback'и порогов probe-триггеров (см. AdminSetting `probe.*`). */
  private static readonly DEFAULT_REPLY_LATENCY_RISE_FACTOR = 2;
  private static readonly DEFAULT_WORKLOAD_OVERLOAD_LOAD_PERCENT = 120;
  private static readonly DEFAULT_MEETING_NOSHOWS_COUNT = 3;
  /** Минимум сэмплов для надёжного latency-baseline. */
  private static readonly LATENCY_MIN_BASELINE = 5;
  private static readonly LATENCY_MIN_RECENT = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /** Daily в 03:45 UTC (после Engagement-Scorer 03:00). */
  @Cron('45 3 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'burnout-risk-detector: проход завершён');
    } catch (err) {
      this.logger.error(
        `burnout-risk-detector fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    personsScanned: number;
    personsWithFlags: number;
    errors: number;
  }> {
    const now = new Date();
    const since7 = new Date(now.getTime() - BurnoutRiskDetectorCron.WINDOW_7D_MS);
    const since14 = new Date(now.getTime() - BurnoutRiskDetectorCron.WINDOW_14D_MS);
    const since28 = new Date(now.getTime() - BurnoutRiskDetectorCron.WINDOW_28D_MS);
    const since90 = new Date(now.getTime() - BurnoutRiskDetectorCron.WINDOW_90D_MS);

    const thresholds = await this.readProbeThresholds();

    // ВАЖНО: только employee с analyticsOptIn=true (Wave 4.1 — 152-ФЗ).
    // Без opt-in карточка показывает только базовые данные, без risk-flags.
    const persons = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        analyticsOptIn: true,
      },
      select: { id: true, tenantId: true, entityId: true, userId: true },
    });

    let personsScanned = 0;
    let personsWithFlags = 0;
    let errors = 0;

    for (const person of persons) {
      personsScanned++;
      try {
        const flags = await this.computeFlags({
          person,
          now,
          since7,
          since14,
          since28,
          since90,
          thresholds,
        });
        await this.prisma.person.update({
          where: { id: person.id },
          data: {
            riskFlagsJson: {
              flags,
              generatedAt: now.toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        if (flags.length > 0) personsWithFlags++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `burnout-risk-detector person ${person.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { personsScanned, personsWithFlags, errors };
  }

  /**
   * Читает пороги probe-триггеров из AdminSetting (`probe.*`) с code-fallback.
   */
  private async readProbeThresholds(): Promise<ProbeThresholds> {
    const [replyLatencyRiseFactor, workloadOverloadLoadPercent, meetingNoshowsCount] =
      await Promise.all([
        this.cfg.getDynamic<number>(
          'probe.reply_latency_rise.factor',
          'PROBE_REPLY_LATENCY_RISE_FACTOR',
          BurnoutRiskDetectorCron.DEFAULT_REPLY_LATENCY_RISE_FACTOR,
        ),
        this.cfg.getDynamic<number>(
          'probe.workload_overload.load_percent',
          'PROBE_WORKLOAD_OVERLOAD_LOAD_PERCENT',
          BurnoutRiskDetectorCron.DEFAULT_WORKLOAD_OVERLOAD_LOAD_PERCENT,
        ),
        this.cfg.getDynamic<number>(
          'probe.meeting_noshows.count',
          'PROBE_MEETING_NOSHOWS_COUNT',
          BurnoutRiskDetectorCron.DEFAULT_MEETING_NOSHOWS_COUNT,
        ),
      ]);
    return {
      replyLatencyRiseFactor,
      workloadOverloadLoadPercent,
      meetingNoshowsCount,
    };
  }

  /** Одно облегчённое исследование per Person. */
  private async computeFlags(args: {
    person: {
      id: string;
      tenantId: string;
      entityId: string | null;
      userId: string | null;
    };
    now: Date;
    since7: Date;
    since14: Date;
    since28: Date;
    since90: Date;
    thresholds: ProbeThresholds;
  }): Promise<RiskFlag[]> {
    const { person, now, since7, since14, since28, since90, thresholds } = args;
    const flags: RiskFlag[] = [];

    // ── 1. sentiment_dip ─────────────────────────────────────────────────
    // green-share recent (14d) vs baseline (15-90d). Нужно ≥10 baseline + ≥3 recent.
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        personId: person.id,
        createdAt: { gte: since90 },
        sentiment: { in: ['green', 'yellow', 'red'] },
      },
      select: { sentiment: true, createdAt: true },
    });
    const recent = checkIns.filter((c) => c.createdAt >= since14);
    const baseline = checkIns.filter((c) => c.createdAt < since14);
    if (baseline.length >= 10 && recent.length >= 3) {
      const baselineGreenShare =
        baseline.filter((c) => c.sentiment === 'green').length / baseline.length;
      const recentGreenShare =
        recent.filter((c) => c.sentiment === 'green').length / recent.length;
      const drop = baselineGreenShare - recentGreenShare;
      if (drop >= 0.2) {
        flags.push({
          type: 'sentiment_dip',
          severity: drop >= 0.4 ? 'high' : 'medium',
          baseline: Math.round(baselineGreenShare * 100),
          current: Math.round(recentGreenShare * 100),
          explanation: `Доля «зелёных» чек-инов упала с ${Math.round(
            baselineGreenShare * 100,
          )}% до ${Math.round(recentGreenShare * 100)}% за 14 дней.`,
        });
      }
    }

    // ── 3. missed_checkins ───────────────────────────────────────────────
    // Ожидаемое — 5 evening чек-инов в неделю (≈ рабочие дни).
    const eveningCount = await this.prisma.dailyCheckIn.count({
      where: {
        personId: person.id,
        kind: 'evening',
        createdAt: { gte: since7 },
      },
    });
    if (eveningCount < 3) {
      flags.push({
        type: 'missed_checkins',
        severity: eveningCount === 0 ? 'high' : 'medium',
        baseline: 5,
        current: eveningCount,
        explanation: `Только ${eveningCount} вечерних чек-инов за неделю (ожидаем ~5).`,
      });
    }

    // ── 4. broken_promises ───────────────────────────────────────────────
    // ≥3 missed commitment-обещаний, адресованных этому человеку, за 28 дней.
    const brokenCount = await this.prisma.ideaBlock.count({
      where: {
        tenantId: person.tenantId,
        signalType: 'commitment',
        commitmentRecipientPersonId: person.id,
        commitmentStatus: 'missed',
        commitmentDueDate: { gte: since28, lte: now },
      },
    });
    if (brokenCount >= 3) {
      flags.push({
        type: 'broken_promises',
        severity: brokenCount >= 6 ? 'high' : 'medium',
        baseline: 1,
        current: brokenCount,
        explanation: `Не выполнено ${brokenCount} обещаний за 4 недели.`,
      });
    }

    // ── 7. conflict_mentions ─────────────────────────────────────────────
    // Свежие EntityLink('conflicted_with') с участием entity этого Person.
    if (person.entityId) {
      const conflictCount = await this.prisma.entityLink.count({
        where: {
          tenantId: person.tenantId,
          relationType: 'conflicted_with',
          deletedAt: null,
          createdAt: { gte: since14 },
          OR: [
            { fromEntityId: person.entityId },
            { toEntityId: person.entityId },
          ],
        },
      });
      if (conflictCount >= 1) {
        flags.push({
          type: 'conflict_mentions',
          severity: conflictCount >= 3 ? 'high' : 'medium',
          baseline: 0,
          current: conflictCount,
          explanation: `${conflictCount} упоминаний конфликта за 14 дней.`,
        });
      }
    }

    // ── 2. reply_latency_rise ────────────────────────────────────────────
    // Средняя задержка ответа (Notification.respondedAt − createdAt) recent
    // (14d) vs baseline (15-90d). Нужно ≥LATENCY_MIN_BASELINE baseline-сэмплов
    // и ≥LATENCY_MIN_RECENT recent. Триггер при росте в ≥factor раз.
    if (person.userId) {
      const responded = await this.prisma.notification.findMany({
        where: {
          tenantId: person.tenantId,
          recipientUserId: person.userId,
          respondedAt: { not: null, gte: since90 },
        },
        select: { createdAt: true, respondedAt: true },
      });
      const recentLat: number[] = [];
      const baselineLat: number[] = [];
      for (const n of responded) {
        if (!n.respondedAt) continue;
        const latencyMs = n.respondedAt.getTime() - n.createdAt.getTime();
        if (latencyMs < 0) continue; // защита от рассинхрона часов
        if (n.respondedAt >= since14) recentLat.push(latencyMs);
        else baselineLat.push(latencyMs);
      }
      if (
        baselineLat.length >= BurnoutRiskDetectorCron.LATENCY_MIN_BASELINE &&
        recentLat.length >= BurnoutRiskDetectorCron.LATENCY_MIN_RECENT
      ) {
        const baselineAvg = avg(baselineLat);
        const recentAvg = avg(recentLat);
        if (
          detectReplyLatencyRise(
            recentAvg,
            baselineAvg,
            thresholds.replyLatencyRiseFactor,
          )
        ) {
          const ratio = baselineAvg === 0 ? 0 : recentAvg / baselineAvg;
          const baselineH = Math.round(baselineAvg / 3600_000);
          const recentH = Math.round(recentAvg / 3600_000);
          flags.push({
            type: 'reply_latency_rise',
            severity: ratio >= thresholds.replyLatencyRiseFactor * 2 ? 'high' : 'medium',
            baseline: baselineH,
            current: recentH,
            explanation: `Среднее время ответа выросло с ~${baselineH} ч до ~${recentH} ч за 14 дней — возможно, перегружен.`,
          });
          this.metrics.incProbeSuggested({ trigger: 'reply_latency_rise' });
        }
      }
    }

    // ── 5. workload_overload ─────────────────────────────────────────────
    // Активное назначение (Appointment.status='active') с loadPercent выше
    // порога. Берём максимальную загрузку по активным назначениям.
    const topLoad = await this.prisma.appointment.aggregate({
      where: {
        tenantId: person.tenantId,
        personId: person.id,
        status: 'active',
      },
      _max: { loadPercent: true },
    });
    const maxLoad = topLoad._max.loadPercent ?? 0;
    if (detectWorkloadOverload(maxLoad, thresholds.workloadOverloadLoadPercent)) {
      flags.push({
        type: 'workload_overload',
        severity:
          maxLoad >= thresholds.workloadOverloadLoadPercent + 30 ? 'high' : 'medium',
        baseline: thresholds.workloadOverloadLoadPercent,
        current: maxLoad,
        explanation: `Загрузка по назначениям ${maxLoad}% (порог ${thresholds.workloadOverloadLoadPercent}%) — обсудите нагрузку.`,
      });
      this.metrics.incProbeSuggested({ trigger: 'workload_overload' });
    }

    // ── 6. meeting_noshows ───────────────────────────────────────────────
    // Повторные неявки: участник был приглашён (invitationStatus='invited'),
    // но не присоединился (joinedAt=NULL) к завершившейся встрече за 28 дней.
    // Встреча «завершена» = endedAt проставлен (не зависит от пост-обработки
    // AI-статусов: completed/ai_processing/ai_ready/… все имеют endedAt).
    const noshowCount = await this.prisma.participant.count({
      where: {
        personId: person.id,
        invitationStatus: 'invited',
        joinedAt: null,
        meeting: {
          tenantId: person.tenantId,
          endedAt: { gte: since28, lte: now },
        },
      },
    });
    if (detectMeetingNoshows(noshowCount, thresholds.meetingNoshowsCount)) {
      flags.push({
        type: 'meeting_noshows',
        severity:
          noshowCount >= thresholds.meetingNoshowsCount * 2 ? 'high' : 'medium',
        baseline: thresholds.meetingNoshowsCount,
        current: noshowCount,
        explanation: `Пропущено ${noshowCount} встреч за 4 недели (порог ${thresholds.meetingNoshowsCount}) — уточните, что мешает.`,
      });
      this.metrics.incProbeSuggested({ trigger: 'meeting_noshows' });
    }

    return flags;
  }
}

/** Пороги probe-триггеров (читаются из AdminSetting `probe.*`). */
export interface ProbeThresholds {
  /** Во сколько раз должна вырасти средняя задержка ответа (≥). */
  replyLatencyRiseFactor: number;
  /** Порог Appointment.loadPercent для перегрузки (строго >). */
  workloadOverloadLoadPercent: number;
  /** Минимум неявок за окно для триггера (≥). */
  meetingNoshowsCount: number;
}

/** Среднее непустого массива чисел (0 для пустого). */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * ТЗ-1 Ф3.D.3 — чистый детектор `reply_latency_rise`.
 * Триггер: baseline > 0 И recent >= baseline * factor.
 */
export function detectReplyLatencyRise(
  recentAvg: number,
  baselineAvg: number,
  factor: number,
): boolean {
  if (baselineAvg <= 0) return false;
  return recentAvg >= baselineAvg * factor;
}

/**
 * ТЗ-1 Ф3.D.3 — чистый детектор `workload_overload`.
 * Триггер: loadPercent строго больше порога.
 */
export function detectWorkloadOverload(
  loadPercent: number,
  threshold: number,
): boolean {
  return loadPercent > threshold;
}

/**
 * ТЗ-1 Ф3.D.3 — чистый детектор `meeting_noshows`.
 * Триггер: число неявок >= порога.
 */
export function detectMeetingNoshows(
  noshowCount: number,
  threshold: number,
): boolean {
  return noshowCount >= threshold;
}

/**
 * Один активный risk-flag (Pulse Wave 4 §4.5).
 *
 * `baseline` / `current` — числа в шкале, специфичной для типа флага
 * (проценты для sentiment, абсолютные count'ы для остальных). UI должен
 * рендерить `explanation` как основной текст, baseline/current — как
 * вспомогательный контекст.
 */
export interface RiskFlag {
  type:
    | 'sentiment_dip'
    | 'reply_latency_rise'
    | 'missed_checkins'
    | 'broken_promises'
    | 'workload_overload'
    | 'meeting_noshows'
    | 'conflict_mentions';
  severity: 'low' | 'medium' | 'high';
  baseline: number;
  current: number;
  explanation: string;
}
