import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

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
 * Сигналы v1 (7 типов, 4 активны, 3 — TODO):
 *   1. sentiment_dip        — green-share упал ≥0.2 от 14d vs 90d baseline.
 *   2. reply_latency_rise   — TODO когда появится latency tracking.
 *   3. missed_checkins      — <3 evening чек-инов за последние 7 дней.
 *   4. broken_promises      — ≥3 missed commitment'ов за 28 дней.
 *   5. workload_overload    — TODO когда появится capacity tracking.
 *   6. meeting_noshows      — TODO когда появится no-show tracking.
 *   7. conflict_mentions    — ≥1 EntityLink('conflicted_with') за 14 дней.
 *
 * Best-effort: ошибка по одному Person'у не валит остальных.
 *
 * EU AI Act: это поведенческая аналитика на основе деятельности
 * (чек-ины / обещания / упоминания), а не emotion recognition.
 */
@Injectable()
export class BurnoutRiskDetectorCron {
  private readonly logger = new Logger(BurnoutRiskDetectorCron.name);
  private static readonly WINDOW_7D_MS = 7 * 24 * 3600 * 1000;
  private static readonly WINDOW_14D_MS = 14 * 24 * 3600 * 1000;
  private static readonly WINDOW_28D_MS = 28 * 24 * 3600 * 1000;
  private static readonly WINDOW_90D_MS = 90 * 24 * 3600 * 1000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Daily в 03:45 UTC (после Engagement-Scorer 03:00). */
  @Cron('45 3 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(stats, 'burnout-risk-detector: проход завершён');
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

    // ВАЖНО: только employee с analyticsOptIn=true (Wave 4.1 — 152-ФЗ).
    // Без opt-in карточка показывает только базовые данные, без risk-flags.
    const persons = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        analyticsOptIn: true,
      },
      select: { id: true, tenantId: true, entityId: true },
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

  /** Одно облегчённое исследование per Person. */
  private async computeFlags(args: {
    person: { id: string; tenantId: string; entityId: string | null };
    now: Date;
    since7: Date;
    since14: Date;
    since28: Date;
    since90: Date;
  }): Promise<RiskFlag[]> {
    const { person, now, since7, since14, since28, since90 } = args;
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

    // ── 2 / 5 / 6 ────────────────────────────────────────────────────────
    // TODO: reply_latency_rise / workload_overload / meeting_noshows —
    // ждут tracking-инфраструктуру, см. ТЗ §4.5.

    return flags;
  }
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
