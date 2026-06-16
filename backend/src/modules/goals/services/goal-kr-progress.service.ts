import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class GoalKrProgressService {
  private readonly logger = new Logger(GoalKrProgressService.name);

  static readonly TREND_WINDOW_DAYS = 14;

  static readonly AT_RISK_MARGIN = 25;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async runForAllOrgs(): Promise<GoalKrProgressSummary> {
    const orgs = await this.listOrgsWithActiveGoals();
    let krsUpdated = 0;
    let krsSkipped = 0;
    let goalsRestatused = 0;
    let failures = 0;

    for (const tenantId of orgs) {
      try {
        const goals = await this.listActiveGoals(tenantId);
        for (const goal of goals) {
          try {
            const res = await this.processGoalKr({ tenantId, goal });
            krsUpdated += res.krsUpdated;
            krsSkipped += res.krsSkipped;
            goalsRestatused += res.restatused ? 1 : 0;
          } catch (err) {
            failures += 1;
            this.logger.warn(
              {
                tenantId,
                goalId: goal.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'goal-kr-progress: ошибка обработки цели — продолжаю',
            );
          }
        }
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { tenantId, err: err instanceof Error ? err.message : String(err) },
          'goal-kr-progress: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      orgsScanned: orgs.length,
      krsUpdated,
      krsSkipped,
      goalsRestatused,
      failures,
    };
  }

  async processGoalKr(args: {
    tenantId: string;
    goal: ActiveGoalRow;
  }): Promise<{ krsUpdated: number; krsSkipped: number; restatused: boolean }> {
    const { tenantId, goal } = args;

    const krs = await this.prisma.goalKeyResult.findMany({
      where: { tenantId, goalId: goal.id },
      select: {
        id: true,
        sourceKind: true,
        sourceConfig: true,
        manualOverride: true,
        startValue: true,
        targetValue: true,
        currentValue: true,
      },
    });

    let krsUpdated = 0;
    let krsSkipped = 0;
    for (const kr of krs) {
      const res = await this.computeKrValue({ tenantId, goal, kr });
      if (res.updated) krsUpdated += 1;
      if (res.skipped) krsSkipped += 1;
    }

    const restatused = await this.recomputeProgressStatus({ tenantId, goal });
    return { krsUpdated, krsSkipped, restatused };
  }

  private async computeKrValue(args: {
    tenantId: string;
    goal: ActiveGoalRow;
    kr: KrRow;
  }): Promise<{ updated: boolean; skipped: boolean }> {
    const { tenantId, goal, kr } = args;

    if (kr.sourceKind === 'manual') {
      this.metrics.incGoalKrAutoprogress('manual', 'skipped');
      return { updated: false, skipped: true };
    }
    if (GoalKrProgressService.overrideHas(kr.manualOverride, 'currentValue')) {
      this.metrics.incGoalKrAutoprogress(kr.sourceKind, 'skipped');
      return { updated: false, skipped: true };
    }

    let newValue: number | null = null;
    try {
      switch (kr.sourceKind) {
        case 'meeting_count':
          newValue = await this.countMeetings({ tenantId, kr });
          break;
        case 'issue_rollup':
          newValue = await this.countCompletedIssues({
            tenantId,
            goalId: goal.id,
          });
          break;
        case 'metric_entity':
          newValue = await this.readEntityMentions({ tenantId, kr });
          break;
        default:
          newValue = null;
      }
    } catch (err) {
      this.metrics.incGoalKrAutoprogress(kr.sourceKind, 'error');
      this.logger.warn(
        {
          tenantId,
          krId: kr.id,
          sourceKind: kr.sourceKind,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-kr-progress: ошибка вычисления KR — пропускаю',
      );
      return { updated: false, skipped: true };
    }

    if (newValue === null) {
      this.metrics.incGoalKrAutoprogress(kr.sourceKind, 'skipped');
      return { updated: false, skipped: true };
    }

    const oldValue = GoalKrProgressService.toNumber(kr.currentValue);
    if (newValue === oldValue) {
      this.metrics.incGoalKrAutoprogress(kr.sourceKind, 'unchanged');
      return { updated: false, skipped: false };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.goalKeyResult.update({
        where: { id: kr.id },
        data: { currentValue: GoalKrProgressService.dec(newValue as number) },
      });
      await tx.goalKeyResultCheckpoint.create({
        data: {
          tenantId,
          keyResultId: kr.id,
          value: GoalKrProgressService.dec(newValue as number),
          recordedBy: 'auto',
        },
      });
    });

    this.metrics.incGoalKrAutoprogress(kr.sourceKind, 'ok');
    return { updated: true, skipped: false };
  }

  private async countMeetings(args: { tenantId: string; kr: KrRow }): Promise<number> {
    const cfg = GoalKrProgressService.parseConfig(args.kr.sourceConfig);
    const meetingType = typeof cfg.meetingType === 'string' ? cfg.meetingType : undefined;
    const since = GoalKrProgressService.parseDate(cfg.since);

    return this.prisma.meeting.count({
      where: {
        tenantId: args.tenantId,
        status: 'completed',
        deletedAt: null,
        ...(meetingType ? { type: meetingType as Prisma.MeetingWhereInput['type'] } : {}),
        ...(since ? { endedAt: { gte: since } } : {}),
      },
    });
  }

  private async countCompletedIssues(args: { tenantId: string; goalId: string }): Promise<number> {
    return this.prisma.issue.count({
      where: {
        tenantId: args.tenantId,
        goalId: args.goalId,
        deletedAt: null,
        state: { category: 'completed' },
      },
    });
  }

  private async readEntityMentions(args: { tenantId: string; kr: KrRow }): Promise<number | null> {
    const cfg = GoalKrProgressService.parseConfig(args.kr.sourceConfig);
    const entityId = typeof cfg.entityId === 'string' ? cfg.entityId : null;
    if (!entityId) {
      this.logger.warn(
        { tenantId: args.tenantId, krId: args.kr.id },
        'goal-kr-progress: metric_entity без entityId — пропускаю',
      );
      return null;
    }
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, tenantId: args.tenantId },
      select: { mentionsCount: true },
    });
    if (!entity) {
      this.logger.warn(
        { tenantId: args.tenantId, krId: args.kr.id, entityId },
        'goal-kr-progress: metric_entity — Entity не найдена, пропускаю',
      );
      return null;
    }
    return entity.mentionsCount;
  }

  private async recomputeProgressStatus(args: {
    tenantId: string;
    goal: ActiveGoalRow;
  }): Promise<boolean> {
    const { tenantId, goal } = args;

    if (GoalKrProgressService.overrideHas(goal.manualOverride, 'progressStatus')) {
      return false;
    }

    const krs = await this.prisma.goalKeyResult.findMany({
      where: { tenantId, goalId: goal.id },
      select: {
        id: true,
        startValue: true,
        targetValue: true,
        currentValue: true,
      },
    });

    if (krs.length === 0) return false;

    const since = new Date(
      Date.now() - GoalKrProgressService.TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const baselines = await Promise.all(
      krs.map(async (kr) => {
        const earliest = await this.prisma.goalKeyResultCheckpoint.findFirst({
          where: { keyResultId: kr.id, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: { value: true },
        });
        return earliest
          ? GoalKrProgressService.toNumber(earliest.value)
          : GoalKrProgressService.toNumber(kr.startValue);
      }),
    );

    const trend: KrTrendInput[] = krs.map((kr, i) => ({
      start: GoalKrProgressService.toNumber(kr.startValue),
      target: GoalKrProgressService.toNumber(kr.targetValue),
      current: GoalKrProgressService.toNumber(kr.currentValue),
      baseline: baselines[i] ?? GoalKrProgressService.toNumber(kr.startValue),
    }));

    const next = GoalKrProgressService.computeStatus({
      krs: trend,
      createdAt: goal.createdAt,
      targetDate: goal.targetDate,
      now: new Date(),
    });

    if (next === goal.progressStatus) return false;

    await this.prisma.goal.update({
      where: { id: goal.id },
      data: { progressStatus: next },
    });
    return true;
  }

  static progressPercent(start: number, target: number, current: number): number {
    const span = target - start;
    if (span === 0) return 0;
    const pct = ((current - start) / span) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }

  static computeStatus(args: {
    krs: KrTrendInput[];
    createdAt: Date;
    targetDate: Date | null;
    now: Date;
  }): GoalProgressStatusValue {
    const { krs, createdAt, targetDate, now } = args;
    if (krs.length === 0) return 'on_track';

    const avgProgress =
      krs.reduce(
        (acc, k) => acc + GoalKrProgressService.progressPercent(k.start, k.target, k.current),
        0,
      ) / krs.length;

    if (avgProgress >= 100) return 'achieved';

    const goalDelta = krs.reduce((acc, k) => acc + (k.current - k.baseline), 0);
    if (goalDelta <= 0) return 'stalled';

    if (targetDate) {
      const expected = GoalKrProgressService.expectedProgress({
        createdAt,
        targetDate,
        now,
      });
      if (avgProgress < expected - GoalKrProgressService.AT_RISK_MARGIN) {
        return 'at_risk';
      }
    }
    return 'on_track';
  }

  static expectedProgress(args: { createdAt: Date; targetDate: Date; now: Date }): number {
    const total = args.targetDate.getTime() - args.createdAt.getTime();
    if (total <= 0) return 100;
    const elapsed = args.now.getTime() - args.createdAt.getTime();
    const pct = (elapsed / total) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  private static dec(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(4));
  }

  static toNumber(v: unknown): number {
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
      } catch {}
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private static overrideHas(raw: unknown, field: string): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return Object.prototype.hasOwnProperty.call(raw as Record<string, unknown>, field);
  }

  private static parseConfig(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  }

  private static parseDate(raw: unknown): Date | undefined {
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private async listOrgsWithActiveGoals(): Promise<string[]> {
    const rows = await this.prisma.goal.findMany({
      where: { promotionState: 'active', validUntil: null },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    return rows.map((r) => r.tenantId);
  }

  private async listActiveGoals(tenantId: string): Promise<ActiveGoalRow[]> {
    return this.prisma.goal.findMany({
      where: { tenantId, promotionState: 'active', validUntil: null },
      select: {
        id: true,
        createdAt: true,
        targetDate: true,
        progressStatus: true,
        manualOverride: true,
      },
    });
  }
}

export type GoalProgressStatusValue = 'on_track' | 'at_risk' | 'stalled' | 'achieved' | 'dropped';

export interface GoalKrProgressSummary {
  orgsScanned: number;
  krsUpdated: number;
  krsSkipped: number;
  goalsRestatused: number;
  failures: number;
}

export interface ActiveGoalRow {
  id: string;
  createdAt: Date;
  targetDate: Date | null;
  progressStatus: GoalProgressStatusValue;
  manualOverride: unknown;
}

interface KrRow {
  id: string;
  sourceKind: 'manual' | 'meeting_count' | 'issue_rollup' | 'metric_entity';
  sourceConfig: unknown;
  manualOverride: unknown;
  startValue: unknown;
  targetValue: unknown;
  currentValue: unknown;
}

export interface KrTrendInput {
  start: number;
  target: number;
  current: number;
  baseline: number;
}
