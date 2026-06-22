import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

const SWEEP_BATCH = 200;

@Injectable()
export class ChatboxAnalyzeCron {
  private readonly logger = new Logger(ChatboxAnalyzeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly queue: ChatboxAnalyzeQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'ChatboxAnalyzeCron.sweep',
    timeZone: 'Europe/Moscow',
  })
  async sweep(): Promise<void> {
    try {
      const enabled = (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('analyze-sweep: chatbox.enabled=false — пропуск');
        return;
      }

      const enabledIntegrations = await this.prisma.chatboxIntegration.findMany({
        where: { analysisEnabled: true },
        select: { tenantId: true },
      });
      const enabledTenantIds = enabledIntegrations.map((i) => i.tenantId);
      if (enabledTenantIds.length === 0) {
        this.logger.debug('analyze-sweep: нет интеграций с включённым анализом — пропуск');
        return;
      }

      const sessions = await this.prisma.chatboxChatSession.findMany({
        where: {
          analysisStatus: 'pending',
          endedAt: { not: null },
          tenantId: { in: enabledTenantIds },
        },
        select: { id: true, tenantId: true },
        take: SWEEP_BATCH,
        orderBy: { endedAt: 'asc' },
      });

      let enqueued = 0;
      for (const { id, tenantId } of sessions) {
        try {
          await this.queue.enqueue(tenantId, id);
          enqueued += 1;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              sessionId: id,
              err: err instanceof Error ? err.message : String(err),
            },
            'analyze-sweep: не удалось поставить job — пропуск',
          );
        }
      }

      try {
        const totalPending = await this.prisma.chatboxChatSession.count({
          where: { analysisStatus: 'pending', endedAt: { not: null } },
        });
        this.metrics?.setChatboxPendingSessions(totalPending);
      } catch (gaugeErr) {
        this.logger.warn(
          { err: gaugeErr instanceof Error ? gaugeErr.message : String(gaugeErr) },
          'analyze-sweep: не удалось обновить gauge pending-сессий',
        );
      }

      this.logger.debug(`analyze-sweep: pending=${sessions.length} enqueued=${enqueued}`);
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'analyze-sweep: глобальная ошибка прохода',
      );
    }
  }
}
