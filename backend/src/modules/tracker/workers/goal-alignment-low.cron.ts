import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { ProbeService } from '../../probe/probe.service';

const DEFAULT_PERIOD_DAYS = 14;
const DEFAULT_MIN_ISSUES = 5;
const DEFAULT_LOW_RATIO = 0.8;
const DEFAULT_DEDUP_TTL_SECONDS = 86_400;

interface CandidateUser {
  userId: string;
  totalIssues: number;
  withoutGoalCount: number;
  ratio: number;
}

@Injectable()
export class GoalAlignmentLowCron {
  private readonly logger = new Logger(GoalAlignmentLowCron.name);

  static readonly PERIOD_DAYS = DEFAULT_PERIOD_DAYS;
  static readonly MIN_ISSUES = DEFAULT_MIN_ISSUES;
  static readonly LOW_RATIO = DEFAULT_LOW_RATIO;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(ProbeService)
    private readonly probe?: ProbeService,
  ) {}

  @Cron('0 6 * * 1', { timeZone: 'Europe/Moscow' })
  async runScheduled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.goalAlignmentLowEnabled',
      'GOAL_ALIGNMENT_LOW_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('goal-alignment-low: выключен через ENV — пропуск');
      return;
    }
    try {
      const summary = await this.run();
      this.logger.debug(summary, 'goal-alignment-low: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'goal-alignment-low: непойманная ошибка',
      );
    }
  }

  async run(): Promise<{
    scannedOrgs: number;
    scannedUsers: number;
    emitted: number;
    dedupSkipped: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const periodStart = new Date(Date.now() - GoalAlignmentLowCron.PERIOD_DAYS * 24 * 3600 * 1000);
    const todayKey = this.todayKey();

    let scannedUsers = 0;
    let emitted = 0;
    let dedupSkipped = 0;

    for (const org of orgs) {
      let memberships: Array<{ userId: string }>;
      try {
        memberships = await this.prisma.membership.findMany({
          where: { orgId: org.id },
          select: { userId: true },
        });
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'goal-alignment-low: ошибка загрузки memberships — пропускаю Org',
        );
        continue;
      }
      if (memberships.length === 0) continue;

      const ownerCandidates = await this.findOwnerCandidates(org.id);

      for (const m of memberships) {
        scannedUsers += 1;
        let candidate: CandidateUser | null;
        try {
          candidate = await this.collectUserStats({
            tenantId: org.id,
            userId: m.userId,
            periodStart,
          });
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              userId: m.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-alignment-low: ошибка сбора статистики — пропускаю user',
          );
          continue;
        }
        if (!candidate) continue;

        const dedupOk = await this.dedupAcquire(m.userId, todayKey);
        if (!dedupOk) {
          dedupSkipped += 1;
          continue;
        }

        const sent = await this.emitProbe({
          tenantId: org.id,
          candidate,
          ownerCandidates,
        });
        if (sent) {
          this.metrics.incProbeGoalAlignmentLowEmitted({
            tenantTop: tenantTopOf(org.id),
          });
          emitted += 1;
        }
      }
    }

    return {
      scannedOrgs: orgs.length,
      scannedUsers,
      emitted,
      dedupSkipped,
    };
  }

  private async collectUserStats(args: {
    tenantId: string;
    userId: string;
    periodStart: Date;
  }): Promise<CandidateUser | null> {
    const baseWhere = {
      tenantId: args.tenantId,
      createdById: args.userId,
      deletedAt: null,
      completedAt: { gte: args.periodStart },
    } as const;
    const [totalIssues, withoutGoalCount] = await Promise.all([
      this.prisma.issue.count({ where: baseWhere }),
      this.prisma.issue.count({
        where: { ...baseWhere, goalId: null },
      }),
    ]);
    if (totalIssues < GoalAlignmentLowCron.MIN_ISSUES) return null;
    const ratio = withoutGoalCount / totalIssues;
    if (ratio < GoalAlignmentLowCron.LOW_RATIO) return null;
    return {
      userId: args.userId,
      totalIssues,
      withoutGoalCount,
      ratio,
    };
  }

  private async dedupAcquire(userId: string, dayKey: string): Promise<boolean> {
    const key = `goal_alignment_low:${userId}:${dayKey}`;
    try {
      const res = await this.redis.client.set(key, '1', 'EX', DEFAULT_DEDUP_TTL_SECONDS, 'NX');
      return res !== null;
    } catch (err) {
      this.logger.warn(
        {
          userId,
          dayKey,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-alignment-low: Redis SETNX упал — продолжаю без дедупа',
      );
      return true;
    }
  }

  private async findOwnerCandidates(tenantId: string): Promise<string[]> {
    try {
      const rows = await this.prisma.membership.findMany({
        where: {
          orgId: tenantId,
          role: { in: ['owner', 'admin'] },
        },
        select: { userId: true },
        take: 10,
      });
      return rows.map((r) => r.userId);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-alignment-low: ошибка поиска owner/admin — пропуск ownerCandidates',
      );
      return [];
    }
  }

  private async emitProbe(args: {
    tenantId: string;
    candidate: CandidateUser;
    ownerCandidates: string[];
  }): Promise<boolean> {
    if (!this.probe) {
      this.logger.debug(
        { userId: args.candidate.userId },
        'goal-alignment-low: ProbeService недоступен — probe пропущен',
      );
      return false;
    }
    const recipientSet = new Set<string>([args.candidate.userId, ...args.ownerCandidates]);
    const recipients = Array.from(recipientSet);
    if (recipients.length === 0) return false;
    try {
      const result = await this.probe.suggest({
        tenantId: args.tenantId,
        emittedByService: 'tracker.goal_alignment_low',
        reason: 'goal_alignment_low',
        payload: {
          message:
            `За последние ${GoalAlignmentLowCron.PERIOD_DAYS} дн. ` +
            `${args.candidate.withoutGoalCount} из ${args.candidate.totalIssues} ` +
            'задач созданы без связи с целью.',
          kind: 'goal_alignment_low',
          targetUserId: args.candidate.userId,
          totalIssues: args.candidate.totalIssues,
          withoutGoalCount: args.candidate.withoutGoalCount,
          ratio: Number(args.candidate.ratio.toFixed(3)),
          period: `${GoalAlignmentLowCron.PERIOD_DAYS}d`,
          actionUrl: `/tracker/me/inbox?filter=no_goal`,
        },
        recipientCandidates: recipients,
        priorityHint: 0.3,
        dataClass: 'internal',
      });
      return 'ok' in result && result.ok === true;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          userId: args.candidate.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-alignment-low: ошибка ProbeService.suggest — пропуск',
      );
      return false;
    }
  }

  private todayKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  static get cronExpression(): string {
    return '0 6 * * 1';
  }
}
