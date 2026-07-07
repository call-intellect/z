import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { TableGraphSyncService } from '../services/table-graph-sync.service';

export interface ReconcileSweepSummary {
  scannedOrgs: number;
  created: number;
  updated: number;
  skipped: number;
  expired: number;
  errors: number;
}

@Injectable()
export class TableGraphsyncReconcileCronService {
  private readonly logger = new Logger(TableGraphsyncReconcileCronService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TableGraphSyncService) private readonly graphSync: TableGraphSyncService,
  ) {}

  @Cron('25 */3 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'table-graphsync-reconcile: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'table-graphsync-reconcile: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<ReconcileSweepSummary> {
    const summary: ReconcileSweepSummary = {
      scannedOrgs: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      expired: 0,
      errors: 0,
    };
    if (!(await this.graphSync.isEnabled())) return summary;

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: { some: { role: { in: ['owner', 'admin'] } } },
      },
      select: { id: true },
    });

    for (const org of orgs) {
      try {
        const r = await this.graphSync.reconcileTenant(org.id);
        summary.created += r.created;
        summary.updated += r.updated;
        summary.skipped += r.skipped;
        summary.expired += await this.graphSync.expireDrafts(org.id);
        summary.scannedOrgs++;
      } catch (err) {
        summary.errors++;
        this.logger.warn(
          { tenantId: org.id, err: err instanceof Error ? err.message : String(err) },
          'table-graphsync-reconcile: ошибка на Org — продолжаю',
        );
      }
    }
    return summary;
  }
}
