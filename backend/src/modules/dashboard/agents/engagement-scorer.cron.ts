import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 3 §3.3 — Engagement-Scorer cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §3.3.
 *
 * Daily (`@Cron('0 3 * * *')`) считает сводный engagement score per Person как
 * взвешенную сумму нормированных к личному baseline сигналов:
 *
 *   - sentiment_index      (0.35): green-share минус red-share за 14 дней (нормированный).
 *   - checkin_regularity   (0.25): доля дней с чек-ином за 14 дней.
 *   - commitment_kept_ratio (0.20): kept / (kept + broken + overdue) за 30 дней.
 *   - meeting_activity     (0.20): avg(personTurns / meetingAvgTurns) по
 *     встречам Person за 14 дней, нормировано в [0..1] через окно [0.2..2.0].
 *
 * Запись:
 *   - `Person.engagementScore` + `Person.engagementScoreAt`
 *   - `PersonEngagementSnapshot` — историческая запись (один день — один снапшот).
 *
 * Без LLM — чистая SQL-агрегация (см. ТЗ §3.3).
 *
 * Best-effort: ошибка по одному Person'у не валит остальных. Транзакция —
 * только Person.update + Snapshot.create (двушаговая идемпотентность):
 * повторный запуск в тот же день создаст второй snapshot — это допустимо
 * (тренд просто будет «двойной» точкой), на UI агрегируем по дню.
 */
@Injectable()
export class EngagementScorerCron {
  private readonly logger = new Logger(EngagementScorerCron.name);
  private static readonly WINDOW_14D_MS = 14 * 24 * 3600 * 1000;
  private static readonly WINDOW_30D_MS = 30 * 24 * 3600 * 1000;

  /** Веса сигналов (сумма = 1.0). */
  private static readonly WEIGHTS = {
    sentimentIndex: 0.35,
    checkinRegularity: 0.25,
    commitmentKept: 0.2,
    meetingActivity: 0.2,
  } as const;

  /** Нейтральный baseline (используется когда сигнала недостаточно). */
  private static readonly NEUTRAL_BASELINE = 0.5;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Daily в 03:00 UTC. */
  @Cron('0 3 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'engagement-scorer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `engagement-scorer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{ personsScored: number; errors: number }> {
    const now = new Date();
    const since14 = new Date(now.getTime() - EngagementScorerCron.WINDOW_14D_MS);
    const since30 = new Date(now.getTime() - EngagementScorerCron.WINDOW_30D_MS);

    const persons = await this.prisma.person.findMany({
      where: { deletedAt: null, relationship: 'employee' },
      // userId нужен для сигнала `meeting_activity` — он матчит участников
      // встреч `MeetingParticipantBehavior.participant.userId`.
      select: { id: true, tenantId: true, userId: true },
    });

    let personsScored = 0;
    let errors = 0;

    for (const person of persons) {
      try {
        const score = await this.computeForPerson({ person, now, since14, since30 });
        await this.persistScore({ person, now, ...score });
        personsScored++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `engagement-scorer person ${person.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { personsScored, errors };
  }

  /**
   * Возвращает скор + сырые сигналы (для записи в snapshotJson).
   * Все методы — best-effort и используют `NEUTRAL_BASELINE` как default'ы.
   */
  private async computeForPerson(args: {
    person: { id: string; tenantId: string; userId: string | null };
    now: Date;
    since14: Date;
    since30: Date;
  }): Promise<{
    score: number;
    signals: {
      sentiment_index: number;
      checkin_regularity: number;
      commitment_kept_ratio: number;
      meeting_activity: number;
      baseline: number;
    };
  }> {
    const { person, now, since14, since30 } = args;

    // 1. Sentiment signal: (green - red) / total за 14 дней; [-1..+1] → [0..1].
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        personId: person.id,
        createdAt: { gte: since14 },
        sentiment: { in: ['green', 'yellow', 'red'] },
      },
      select: { sentiment: true },
    });
    const green = checkIns.filter((c) => c.sentiment === 'green').length;
    const red = checkIns.filter((c) => c.sentiment === 'red').length;
    const sentimentRaw = checkIns.length > 0 ? (green - red) / checkIns.length : 0;
    const sentimentIndex = (sentimentRaw + 1) / 2; // [-1..+1] → [0..1]

    // 2. Check-in regularity: число чек-инов / 14 (capped at 1).
    const allCheckInsCount = await this.prisma.dailyCheckIn.count({
      where: { personId: person.id, createdAt: { gte: since14 } },
    });
    const checkinRegularity = Math.min(1, allCheckInsCount / 14);

    // 3. Commitment kept ratio: kept / (kept + broken + overdue) за 30 дней.
    const commits = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: person.tenantId,
        signalType: 'commitment',
        commitmentRecipientPersonId: person.id,
        commitmentDueDate: { gte: since30, lte: now },
      },
      select: { commitmentStatus: true, commitmentDueDate: true },
    });
    const kept = commits.filter((c) => c.commitmentStatus === 'fulfilled').length;
    const broken = commits.filter((c) => c.commitmentStatus === 'missed').length;
    const overdue = commits.filter(
      (c) =>
        (c.commitmentStatus === 'open' || c.commitmentStatus === 'asked') &&
        c.commitmentDueDate !== null &&
        c.commitmentDueDate < now,
    ).length;
    const commitDenom = kept + broken + overdue;
    const commitmentKeptRatio =
      commitDenom > 0 ? kept / commitDenom : EngagementScorerCron.NEUTRAL_BASELINE;

    // 4. Meeting activity: avg(personTurns / meetingAvgTurns) по встречам
    // Person за 14 дней, нормированный окном [0.2..2.0] → [0..1]. Подробнее —
    // см. `computeMeetingActivity` ниже.
    const meetingActivity = await this.computeMeetingActivity({
      person,
      since14,
    });

    // Композитный score.
    const score =
      EngagementScorerCron.WEIGHTS.sentimentIndex * sentimentIndex +
      EngagementScorerCron.WEIGHTS.checkinRegularity * checkinRegularity +
      EngagementScorerCron.WEIGHTS.commitmentKept * commitmentKeptRatio +
      EngagementScorerCron.WEIGHTS.meetingActivity * meetingActivity;

    return {
      score: this.roundDecimal3(score),
      signals: {
        sentiment_index: this.roundDecimal3(sentimentIndex),
        checkin_regularity: this.roundDecimal3(checkinRegularity),
        commitment_kept_ratio: this.roundDecimal3(commitmentKeptRatio),
        meeting_activity: this.roundDecimal3(meetingActivity),
        baseline: EngagementScorerCron.NEUTRAL_BASELINE,
      },
    };
  }

  /**
   * Сигнал `meeting_activity`: насколько активно Person говорит на встречах
   * относительно остальных участников той же встречи. Источник —
   * `MeetingParticipantBehavior.turnsCount` (число turn'ов спикера).
   *
   * Алгоритм:
   *  1. Найти все `MeetingParticipantBehavior`, где Participant принадлежит
   *     Person (через `participant.userId === person.userId`) и встреча
   *     прошла за последние 14 дней.
   *  2. Для каждой такой встречи взять avg(turnsCount) ВСЕХ её участников
   *     (по `meetingBehaviorMetricsId`).
   *  3. ratio = person.turnsCount / avg.
   *  4. Усреднить ratio по встречам Person.
   *  5. Маппинг [0.2..2.0] → [0..1] через линейную интерполяцию с clamp.
   *
   * Edge cases:
   *  - person.userId === null → NEUTRAL_BASELINE (Person не привязан к User —
   *    не можем связать со встречами).
   *  - 0 встреч за 14 дней → NEUTRAL_BASELINE.
   *  - avg === 0 (вырожденный случай) → ratio = 1 (нейтрально).
   */
  private async computeMeetingActivity(args: {
    person: { id: string; tenantId: string; userId: string | null };
    since14: Date;
  }): Promise<number> {
    if (!args.person.userId) return EngagementScorerCron.NEUTRAL_BASELINE;

    const personBehaviors =
      await this.prisma.meetingParticipantBehavior.findMany({
        where: {
          tenantId: args.person.tenantId,
          participant: {
            userId: args.person.userId,
            meeting: { startedAt: { gte: args.since14 } },
          },
        },
        select: { meetingBehaviorMetricsId: true, turnsCount: true },
      });
    if (personBehaviors.length === 0) {
      return EngagementScorerCron.NEUTRAL_BASELINE;
    }

    const metricsIds = [
      ...new Set(personBehaviors.map((b) => b.meetingBehaviorMetricsId)),
    ];
    const allBehaviors =
      await this.prisma.meetingParticipantBehavior.findMany({
        where: { meetingBehaviorMetricsId: { in: metricsIds } },
        select: { meetingBehaviorMetricsId: true, turnsCount: true },
      });

    const avgByMetrics = new Map<string, number>();
    for (const id of metricsIds) {
      const items = allBehaviors.filter(
        (b) => b.meetingBehaviorMetricsId === id,
      );
      const sum = items.reduce((s, b) => s + b.turnsCount, 0);
      const avg = sum / Math.max(1, items.length);
      avgByMetrics.set(id, avg);
    }

    const ratios = personBehaviors.map((b) => {
      const avg = avgByMetrics.get(b.meetingBehaviorMetricsId) ?? 1;
      // avg === 0 — все молчали, считаем нейтрально (ratio=1).
      return avg > 0 ? b.turnsCount / avg : 1;
    });
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;

    // Маппинг [0.2..2.0] → [0..1] с clamp.
    return Math.max(0, Math.min(1, (avgRatio - 0.2) / 1.8));
  }

  private async persistScore(args: {
    person: { id: string; tenantId: string };
    now: Date;
    score: number;
    signals: Record<string, number>;
  }): Promise<void> {
    const { person, now, score, signals } = args;
    await this.prisma.$transaction([
      this.prisma.person.update({
        where: { id: person.id },
        data: {
          engagementScore: new Prisma.Decimal(score),
          engagementScoreAt: now,
        },
      }),
      this.prisma.personEngagementSnapshot.create({
        data: {
          tenantId: person.tenantId,
          personId: person.id,
          score: new Prisma.Decimal(score),
          signalsJson: { signals, baseline: EngagementScorerCron.NEUTRAL_BASELINE } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
  }

  /** Округление до 3 знаков после запятой (для Decimal(4,3)). */
  private roundDecimal3(v: number): number {
    return Math.round(v * 1000) / 1000;
  }
}
