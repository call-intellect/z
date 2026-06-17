import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TaskReconcileService } from '../services/task-reconcile.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * TZ task-dedup (2026-06-16, Ф3) — TaskReconcileCron.
 *
 * Суточный `@Cron('0 3 * * *')` (03:00): обходит активные Org →
 * `TaskReconcileService.reconcileForTenant` (протухание pending-кандидатов
 * на закрытие + пересчёт reopen-rate + подбор пропущенных событием матчей).
 * Образец — `DecisionImplementationCron` (per-Org @Cron + try/catch + глобальный
 * kill-switch + выделенный runOnce(now) для unit-тестов).
 *
 * Глобальный kill-switch `taskReconcile.enabled` (Ship-On, ON по умолчанию):
 * при OFF крон вообще НЕ трогает БД (ранний return до findMany). БЕЗ LLM.
 */
@Injectable()
export class TaskReconcileCron {
  private readonly logger = new Logger(TaskReconcileCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TaskReconcileService) private readonly svc: TaskReconcileService,
  ) {}

  @Cron('0 3 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'taskReconcile.enabled',
      'TASK_RECONCILE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'task-reconcile.cron: taskReconcile.enabled=false, skip (БД не трогаем)',
      );
      return;
    }
    try {
      const stats = await this.runOnce(new Date());
      this.logger.log(stats, 'task-reconcile.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'task-reconcile.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    expired: number;
    reopened: number;
    reEmitted: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let expired = 0;
    let reopened = 0;
    let reEmitted = 0;
    let errors = 0;

    for (const org of orgs) {
      try {
        const res = await this.svc.reconcileForTenant({
          tenantId: org.id,
          now,
        });
        expired += res.expired;
        reopened += res.reopened;
        reEmitted += res.reEmitted;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop: resolveOperationsTenantTop(org.id),
            err: err instanceof Error ? err.message : String(err),
          },
          'task-reconcile.cron: Org упал',
        );
      }
    }

    return {
      orgsProcessed: orgs.length,
      expired,
      reopened,
      reEmitted,
      errors,
    };
  }
}
