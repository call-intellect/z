import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Experiment } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist39ExperimentProbeService } from '../services/specialist-3-9-experiment-probe.service';
import { resolveAxisTenantTop } from '../services/tenant-top';

@Injectable()
export class ExperimentStatusResolverCron {
  private readonly logger = new Logger(ExperimentStatusResolverCron.name);
  private static readonly BATCH_LIMIT = 500;
  private static readonly AUTO_TRANSITION_MIN_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(Specialist39ExperimentProbeService)
    private readonly probes: Specialist39ExperimentProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalTransitioned = 0;
      let totalNoOwner = 0;
      let totalRunningTooLong = 0;
      for (const org of orgs) {
        try {
          totalTransitioned += await this.resolveStatusesForOrg(org.id);
          totalNoOwner += await this.probes.checkNoOwnerForOrg(org.id);
          totalRunningTooLong += await this.probes.checkRunningTooLongForOrg(org.id);
          await this.refreshOrgGauges(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'experiment-status-resolver: ошибка обработки Org — пропускаю',
          );
        }
      }

      this.logger.debug(
        {
          orgs: orgs.length,
          totalTransitioned,
          totalNoOwner,
          totalRunningTooLong,
          autoEnabled: this.cfg.experiments.autoStatusTransitionEnabled,
        },
        'experiment-status-resolver: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'experiment-status-resolver: непойманная ошибка',
      );
    }
  }

  private async resolveStatusesForOrg(tenantId: string): Promise<number> {
    if (!this.cfg.experiments.autoStatusTransitionEnabled) {
      return 0;
    }
    const candidates = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        status: { in: ['hypothesis', 'running'] },
      },
      take: ExperimentStatusResolverCron.BATCH_LIMIT,
    });
    let updated = 0;
    const now = new Date();
    for (const exp of candidates) {
      const confidence = Number(exp.confidence);
      if (confidence < ExperimentStatusResolverCron.AUTO_TRANSITION_MIN_CONFIDENCE) {
        continue;
      }
      const targetStatus = this.computeTargetStatus(exp);
      if (!targetStatus || targetStatus === exp.status) continue;
      try {
        // G4 condition-UPDATE (эталон fact-supersede.service.ts:456-471):
        // переводим статус ТОЛЬКО если он всё ещё равен прочитанному (exp.status).
        // Защита от гонки cron ↔ параллельный handler/специалист 3.9: оба могли
        // прочитать 'hypothesis' и оба попытаться UPDATE. updateMany с guard'ом
        // по текущему статусу — атомарно; count===0 → статус уже сменил кто-то
        // другой, наш переход устарел → no-op.
        const res = await this.prisma.experiment.updateMany({
          where: { id: exp.id, status: exp.status },
          data: {
            status: targetStatus,
            startedAt:
              exp.startedAt ??
              (targetStatus === 'running' || targetStatus === 'completed' ? now : null),
            completedAt:
              exp.completedAt ??
              (targetStatus === 'completed' || targetStatus === 'dropped' ? now : null),
            lastConfirmedAt: now,
          },
        });
        if (res.count === 0) {
          // Статус уже изменён параллельно — переход устарел, пропускаем.
          continue;
        }
        updated += 1;
      } catch (err) {
        this.logger.debug(
          {
            experimentId: exp.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'experiment-status-resolver: UPDATE упал — пропускаю',
        );
      }
    }
    return updated;
  }

  private computeTargetStatus(exp: Experiment): string | null {
    const hasResult = (exp.currentResult ?? '').trim().length > 0;
    const lessonsLen = Array.isArray(exp.lessonsJson) ? (exp.lessonsJson as unknown[]).length : 0;
    if (exp.status === 'hypothesis') {
      if (exp.startedAt || hasResult) return 'running';
      return null;
    }
    if (exp.status === 'running') {
      if (hasResult && lessonsLen > 0) return 'completed';
      return null;
    }
    return null;
  }

  private async refreshOrgGauges(tenantId: string): Promise<void> {
    const tenantTop = resolveAxisTenantTop(tenantId);
    try {
      const grouped = await this.prisma.experiment.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      });
      const STATUSES = ['hypothesis', 'running', 'completed', 'dropped', 'paused'] as const;
      const counts = new Map<string, number>();
      for (const g of grouped) counts.set(g.status, g._count._all);
      for (const s of STATUSES) {
        this.metrics.setExperimentsTotal({
          tenantTop,
          status: s,
          value: counts.get(s) ?? 0,
        });
      }

      const running = await this.prisma.experiment.findMany({
        where: { tenantId, status: 'running' },
        select: { startedAt: true },
        take: ExperimentStatusResolverCron.BATCH_LIMIT,
      });
      const now = Date.now();
      for (const r of running) {
        if (!r.startedAt) continue;
        const days = Math.max(0, (now - r.startedAt.getTime()) / (24 * 3600 * 1000));
        this.metrics.observeExperimentRunningDurationDays({
          tenantTop,
          days,
        });
      }
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'experiment-status-resolver.refreshOrgGauges: упал — пропускаю',
      );
    }
  }
}
