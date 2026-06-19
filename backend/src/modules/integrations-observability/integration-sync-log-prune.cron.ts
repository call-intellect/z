import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';

const RETENTION_DAYS = 90;

@Injectable()
export class IntegrationSyncLogPruneCron {
  private readonly logger = new Logger(IntegrationSyncLogPruneCron.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *', { name: 'IntegrationSyncLogPruneCron.run' })
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const res = await this.prisma.integrationSyncRun.deleteMany({
        where: { startedAt: { lt: cutoff } },
      });
      if (res.count > 0) {
        this.logger.log(
          `IntegrationSyncLogPrune: удалено ${res.count} прогонов старше ${RETENTION_DAYS}д`,
        );
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'IntegrationSyncLogPrune: ошибка прохода',
      );
    }
  }
}
