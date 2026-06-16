import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PortfolioHealthService } from '../services/portfolio-health.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class PortfolioHealthSnapshotCron {
  private readonly logger = new Logger(PortfolioHealthSnapshotCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PortfolioHealthService)
    private readonly portfolioHealth: PortfolioHealthService,
  ) {}

  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.portfolio_health.enabled',
      'OPERATIONS_PORTFOLIO_HEALTH_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'portfolio-health-snapshot.cron: operations.portfolio_health.enabled=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'portfolio-health-snapshot.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'portfolio-health-snapshot.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    snapshotsBuilt: number;
    errors: number;
  }> {
    const dateLocal = todayInMoscow(now);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let snapshotsBuilt = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      try {
        await this.portfolioHealth.compute({ tenantId: org.id, dateLocal });
        snapshotsBuilt++;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            dateLocal,
            err: err instanceof Error ? err.message : String(err),
          },
          'portfolio-health-snapshot.cron: compute упал для Org',
        );
      }
    }

    return { orgsProcessed: orgs.length, snapshotsBuilt, errors };
  }
}

export function todayInMoscow(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
