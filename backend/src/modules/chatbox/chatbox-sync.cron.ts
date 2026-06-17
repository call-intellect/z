import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

@Injectable()
export class ChatboxSyncCron {
  private readonly logger = new Logger(ChatboxSyncCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxSyncQueueService)
    private readonly queue: ChatboxSyncQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDaily(): Promise<void> {
    try {
      const enabled = (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('sync-cron: chatbox.enabled=false — пропуск');
        return;
      }

      const integrations = await this.prisma.chatboxIntegration.findMany({
        where: {
          status: { not: 'disconnected' },
        },
        select: { tenantId: true },
      });

      let enqueued = 0;
      for (const { tenantId } of integrations) {
        try {
          await this.queue.enqueue(tenantId, 'incremental');
          enqueued += 1;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'sync-cron: не удалось поставить job — пропуск',
          );
        }
      }

      this.logger.debug(
        `sync-cron(00:00): integrations=${integrations.length} enqueued=${enqueued}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'sync-cron: глобальная ошибка прохода',
      );
    }
  }
}
