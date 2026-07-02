import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class StrategicAlignmentIssuesService {
  private readonly logger = new Logger(StrategicAlignmentIssuesService.name);

  static readonly CACHE_TTL_SEC = 26 * 60 * 60;

  static readonly RECENT_ACTIVITY_WINDOW_DAYS = 7;

  static readonly MISALIGNMENT_WINDOW_DAYS = 30;

  static readonly MISALIGNMENT_MIN_ISSUES = 5;

  static readonly MISALIGNMENT_RATIO_THRESHOLD = 0.8;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async compute(args: { tenantId: string; goalId: string }): Promise<GoalIssueProgressSnapshot> {
    const recentActivityWindowDays = await this.cfg.getDynamic<number>(
      'goals.recentActivityWindowDays',
      undefined,
      StrategicAlignmentIssuesService.RECENT_ACTIVITY_WINDOW_DAYS,
    );

    const goal = await this.prisma.goal.findFirst({
      where: { id: args.goalId, tenantId: args.tenantId },
      select: {
        id: true,
        tenantId: true,
        createdAt: true,
        targetDate: true,
        archivedAt: true,
        status: true,
      },
    });
    if (!goal) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const linkedWhere = {
      tenantId: args.tenantId,
      goalId: args.goalId,
      deletedAt: null,
    };

    const [totalLinkedIssues, completedIssues, blockedIssues, recentlyUpdated] = await Promise.all([
      this.prisma.issue.count({ where: linkedWhere }),
      this.prisma.issue.count({
        where: { ...linkedWhere, state: { category: 'completed' } },
      }),
      this.prisma.issue.count({
        where: { ...linkedWhere, state: { category: 'blocked' } },
      }),
      this.prisma.issue.count({
        where: {
          ...linkedWhere,
          updatedAt: {
            gte: new Date(Date.now() - recentActivityWindowDays * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const timeProgressPct = this.computeTimeProgress({
      createdAt: goal.createdAt,
      targetDate: goal.targetDate,
    });

    const alignmentScore = this.computeAlignmentScore({
      totalLinkedIssues,
      completedIssues,
      hasRecentActivity: recentlyUpdated > 0,
    });

    return {
      goalId: goal.id,
      tenantId: goal.tenantId,
      totalLinkedIssues,
      completedIssues,
      blockedIssues,
      recentlyUpdatedIssues: recentlyUpdated,
      timeProgressPct,
      alignmentScore,
      computedAt: new Date().toISOString(),
    };
  }

  async getCached(goalId: string): Promise<GoalIssueProgressSnapshot | null> {
    try {
      const raw = await this.redis.client.get(this.cacheKey(goalId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GoalIssueProgressSnapshot;
      if (parsed && typeof parsed === 'object' && typeof parsed.alignmentScore === 'number') {
        return parsed;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        { goalId, err: err instanceof Error ? err.message : String(err) },
        'StrategicAlignmentIssuesService.getCached: ошибка чтения кэша',
      );
      return null;
    }
  }

  async setCached(snapshot: GoalIssueProgressSnapshot): Promise<void> {
    const cacheTtlSec = await this.cfg.getDynamic<number>(
      'goals.issueSnapshotCacheTtlSec',
      undefined,
      StrategicAlignmentIssuesService.CACHE_TTL_SEC,
    );
    try {
      await this.redis.client.set(
        this.cacheKey(snapshot.goalId),
        JSON.stringify(snapshot),
        'EX',
        cacheTtlSec,
      );
    } catch (err) {
      this.logger.warn(
        {
          goalId: snapshot.goalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'StrategicAlignmentIssuesService.setCached: ошибка записи кэша',
      );
    }
  }

  async findMisalignedUsers(args: { tenantId: string }): Promise<MisalignedUserCandidate[]> {
    const misalignmentWindowDays = await this.cfg.getDynamic<number>(
      'goals.misalignmentWindowDays',
      undefined,
      StrategicAlignmentIssuesService.MISALIGNMENT_WINDOW_DAYS,
    );
    const misalignmentMinIssues = await this.cfg.getDynamic<number>(
      'goals.misalignmentMinIssues',
      undefined,
      StrategicAlignmentIssuesService.MISALIGNMENT_MIN_ISSUES,
    );
    const misalignmentRatioThreshold = await this.cfg.getDynamic<number>(
      'goals.misalignmentRatioThreshold',
      undefined,
      StrategicAlignmentIssuesService.MISALIGNMENT_RATIO_THRESHOLD,
    );
    const since = new Date(Date.now() - misalignmentWindowDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        createdAt: { gte: since },
        deletedAt: null,
      },
      select: {
        id: true,
        goalId: true,
        assignees: { select: { userId: true } },
        createdById: true,
      },
    });
    const stats = new Map<string, { total: number; withoutGoal: number }>();
    const bump = (userId: string, hasGoal: boolean): void => {
      const s = stats.get(userId) ?? { total: 0, withoutGoal: 0 };
      s.total += 1;
      if (!hasGoal) s.withoutGoal += 1;
      stats.set(userId, s);
    };
    for (const row of rows) {
      const hasGoal = Boolean(row.goalId);
      if (row.assignees.length > 0) {
        for (const a of row.assignees) bump(a.userId, hasGoal);
      } else if (row.createdById) {
        bump(row.createdById, hasGoal);
      }
    }
    const out: MisalignedUserCandidate[] = [];
    for (const [userId, s] of stats.entries()) {
      if (s.total < misalignmentMinIssues) {
        continue;
      }
      const ratio = s.withoutGoal / s.total;
      if (ratio >= misalignmentRatioThreshold) {
        out.push({
          userId,
          totalIssues: s.total,
          issuesWithoutGoal: s.withoutGoal,
          ratio,
        });
      }
    }
    return out;
  }

  async listOrgsWithActiveGoals(): Promise<string[]> {
    const rows = await this.prisma.goal.findMany({
      where: {
        archivedAt: null,
        status: { not: 'abandoned' },
      },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    return rows.map((r) => r.tenantId);
  }

  async listActiveGoalsForOrg(
    tenantId: string,
  ): Promise<Array<{ id: string; createdById: string }>> {
    return this.prisma.goal.findMany({
      where: {
        tenantId,
        archivedAt: null,
        status: { not: 'abandoned' },
      },
      select: { id: true, createdById: true },
    });
  }

  private computeTimeProgress(args: { createdAt: Date; targetDate: Date | null }): number | null {
    if (!args.targetDate) return null;
    const total = args.targetDate.getTime() - args.createdAt.getTime();
    if (total <= 0) return 100;
    const elapsed = Date.now() - args.createdAt.getTime();
    const pct = (elapsed / total) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return Math.round(pct * 100) / 100;
  }

  private computeAlignmentScore(args: {
    totalLinkedIssues: number;
    completedIssues: number;
    hasRecentActivity: boolean;
  }): number {
    if (args.totalLinkedIssues === 0) {
      return 0;
    }
    const completionPart = (args.completedIssues / args.totalLinkedIssues) * 50;
    const recencyPart = args.hasRecentActivity ? 50 : 0;
    const score = Math.round(completionPart + recencyPart);
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
  }

  private cacheKey(goalId: string): string {
    return `goal:issue-snapshot:${goalId}`;
  }
}

export interface GoalIssueProgressSnapshot {
  goalId: string;
  tenantId: string;
  totalLinkedIssues: number;
  completedIssues: number;
  blockedIssues: number;
  recentlyUpdatedIssues: number;
  timeProgressPct: number | null;
  alignmentScore: number;
  computedAt: string;
}

export interface MisalignedUserCandidate {
  userId: string;
  totalIssues: number;
  issuesWithoutGoal: number;
  ratio: number;
}
