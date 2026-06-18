import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class EngagementScorerCron {
  private readonly logger = new Logger(EngagementScorerCron.name);
  private static readonly WINDOW_14D_MS = 14 * 24 * 3600 * 1000;
  private static readonly WINDOW_30D_MS = 30 * 24 * 3600 * 1000;

  private static readonly WEIGHTS = {
    sentimentIndex: 0.35,
    checkinRegularity: 0.25,
    commitmentKept: 0.2,
    meetingActivity: 0.2,
  } as const;

  private static readonly NEUTRAL_BASELINE = 0.5;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const sentimentIndex = (sentimentRaw + 1) / 2;

    const allCheckInsCount = await this.prisma.dailyCheckIn.count({
      where: { personId: person.id, createdAt: { gte: since14 } },
    });
    const checkinRegularity = Math.min(1, allCheckInsCount / 14);

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

    const meetingActivity = await this.computeMeetingActivity({
      person,
      since14,
    });

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

  private async computeMeetingActivity(args: {
    person: { id: string; tenantId: string; userId: string | null };
    since14: Date;
  }): Promise<number> {
    if (!args.person.userId) return EngagementScorerCron.NEUTRAL_BASELINE;

    const personBehaviors = await this.prisma.meetingParticipantBehavior.findMany({
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

    const metricsIds = [...new Set(personBehaviors.map((b) => b.meetingBehaviorMetricsId))];
    const allBehaviors = await this.prisma.meetingParticipantBehavior.findMany({
      where: { meetingBehaviorMetricsId: { in: metricsIds } },
      select: { meetingBehaviorMetricsId: true, turnsCount: true },
    });

    const avgByMetrics = new Map<string, number>();
    for (const id of metricsIds) {
      const items = allBehaviors.filter((b) => b.meetingBehaviorMetricsId === id);
      const sum = items.reduce((s, b) => s + b.turnsCount, 0);
      const avg = sum / Math.max(1, items.length);
      avgByMetrics.set(id, avg);
    }

    const ratios = personBehaviors.map((b) => {
      const avg = avgByMetrics.get(b.meetingBehaviorMetricsId) ?? 1;
      return avg > 0 ? b.turnsCount / avg : 1;
    });
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;

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
          signalsJson: {
            signals,
            baseline: EngagementScorerCron.NEUTRAL_BASELINE,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
  }

  private roundDecimal3(v: number): number {
    return Math.round(v * 1000) / 1000;
  }
}
