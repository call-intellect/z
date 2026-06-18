import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { BitrixSyncQueueService } from './queue/bitrix-sync.queue.service';

@Injectable()
export class BitrixSyncCron {
  private readonly logger = new Logger(BitrixSyncCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BitrixSyncQueueService)
    private readonly queue: BitrixSyncQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDaily(): Promise<void> {
    try {
      const enabled = (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('bitrix sync-cron: bitrix.enabled=false — пропуск');
        return;
      }

      const integrations = await this.prisma.bitrixIntegration.findMany({
        where: { status: 'connected', tenantId: { not: null } },
        select: { tenantId: true },
      });

      let enqueued = 0;
      for (const { tenantId } of integrations) {
        if (!tenantId) continue;
        try {
          await this.queue.enqueue(tenantId, 'all');
          enqueued += 1;
        } catch (err) {
          this.logger.warn(
            { tenantId, err: err instanceof Error ? err.message : String(err) },
            'bitrix sync-cron: не удалось поставить job — пропуск',
          );
        }
      }

      this.logger.debug(
        `bitrix sync-cron(00:00): integrations=${integrations.length} enqueued=${enqueued}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'bitrix sync-cron: глобальная ошибка прохода',
      );
    }
  }
}
