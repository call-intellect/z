import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { Specialist314GoalsService } from '../services/specialist-3-14-goals.service';

@Injectable()
export class GoalHierarchyRebuildCron {
  private readonly logger = new Logger(GoalHierarchyRebuildCron.name);
  private static readonly WORKER_NAME = 'goal-hierarchy-rebuild';
  private static readonly LOCK_KEY = 'goal-hierarchy-rebuild:lock';
  private static readonly LOCK_TTL_SEC = 60 * 60;
  private static readonly DEFAULT_MIN_CONFIDENCE = 0.7;
  private static readonly DEFAULT_PER_ORG_LIMIT = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(Specialist314GoalsService)
    private readonly specialist: Specialist314GoalsService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })
  async sweep(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'goals.hierarchyRebuild.enabled',
      undefined,
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'goal-hierarchy-rebuild.cron: выключен (goals.hierarchyRebuild.enabled=false), skip',
      );
      return;
    }
    let locked = false;
    try {
      const setRes = await this.redis.client.set(
        GoalHierarchyRebuildCron.LOCK_KEY,
        '1',
        'EX',
        GoalHierarchyRebuildCron.LOCK_TTL_SEC,
        'NX',
      );
      locked = setRes === 'OK';
      if (!locked) {
        this.logger.debug(
          'goal-hierarchy-rebuild.cron: lock busy — другой pod выполняет проход, skip',
        );
        return;
      }
      const summary = await this.runOnce();
      this.logger.debug(summary, 'goal-hierarchy-rebuild.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `goal-hierarchy-rebuild.cron: непойманная ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(GoalHierarchyRebuildCron.LOCK_KEY);
        } catch {}
      }
    }
  }

  async runOnce(): Promise<{
    scannedOrgs: number;
    goalsScanned: number;
    reparented: number;
    errors: number;
  }> {
    const minConfidence = await this.cfg.getDynamic<number>(
      'goals.hierarchyRebuildMinConfidence',
      undefined,
      GoalHierarchyRebuildCron.DEFAULT_MIN_CONFIDENCE,
    );
    const perOrgLimit = await this.cfg.getDynamic<number>(
      'goals.hierarchyRebuildPerOrgLimit',
      undefined,
      GoalHierarchyRebuildCron.DEFAULT_PER_ORG_LIMIT,
    );

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: { some: { role: { in: ['owner', 'admin'] } } },
      },
      select: { id: true },
    });

    let scannedOrgs = 0;
    let goalsScanned = 0;
    let reparented = 0;
    let errors = 0;

    for (const org of orgs) {
      try {
        await this.gate.checkOrThrow(org.id, GoalHierarchyRebuildCron.WORKER_NAME);
      } catch {
        continue;
      }
      scannedOrgs += 1;
      const goals = await this.prisma.goal.findMany({
        where: {
          tenantId: org.id,
          archivedAt: null,
          validUntil: null,
          promotionState: { not: 'dismissed' },
        },
        select: { id: true },
        take: perOrgLimit,
      });
      for (const goal of goals) {
        goalsScanned += 1;
        try {
          const res = await this.specialist.rebuildParentForGoal({
            tenantId: org.id,
            goalId: goal.id,
            minConfidence,
          });
          if (res.reparented) reparented += 1;
        } catch (err) {
          errors += 1;
          this.logger.warn(
            {
              goalId: goal.id,
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-hierarchy-rebuild.cron: ошибка на цели — продолжаю',
          );
        }
      }
    }

    return { scannedOrgs, goalsScanned, reparented, errors };
  }
}
