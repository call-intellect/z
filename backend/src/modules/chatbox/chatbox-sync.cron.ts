import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * Cron-планировщик инкрементального синка ChatBox (ТЗ 2026-06-05, Фаза 4).
 *
 *   - `runHourly` (каждый час) — интеграции с `syncMode in (hourly, realtime)`.
 *     `realtime` тоже получает ежечасный поллинг-фолбэк (ТЗ §Р3): даже если
 *     webhook потеряется, раз в час чаты доберутся.
 *   - `runDaily` (каждый день в 03:00) — интеграции с `syncMode = daily`.
 *
 * Оба прохода ставят `incremental`-job через ChatboxSyncQueueService; дедуп по
 * jobId схлопнёт дубликаты. Kill-switch `chatbox.enabled` (admin settings)
 * глушит оба прохода. Тело обёрнуто в try/catch — cron не должен падать.
 */
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

  @Cron(CronExpression.EVERY_HOUR)
  async runHourly(): Promise<void> {
    await this.run('hourly', ['hourly', 'realtime']);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDaily(): Promise<void> {
    await this.run('daily', ['daily']);
  }

  private async run(
    label: string,
    syncModes: Array<'hourly' | 'realtime' | 'daily'>,
  ): Promise<void> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug(`sync-cron(${label}): chatbox.enabled=false — пропуск`);
        return;
      }

      const integrations = await this.prisma.chatboxIntegration.findMany({
        where: {
          syncMode: { in: syncModes },
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
            `sync-cron(${label}): не удалось поставить job — пропуск`,
          );
        }
      }

      this.logger.log(
        `sync-cron(${label}): integrations=${integrations.length} enqueued=${enqueued}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        `sync-cron(${label}): глобальная ошибка прохода`,
      );
    }
  }
}
