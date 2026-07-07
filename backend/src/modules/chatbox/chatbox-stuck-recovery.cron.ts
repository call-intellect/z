import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';
import { IntegrationSyncLogService } from '../integrations-observability/integration-sync-log.service';

import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

const DEFAULT_STUCK_MIN = 30;

@Injectable()
export class ChatboxStuckRecoveryCron {
  private readonly logger = new Logger(ChatboxStuckRecoveryCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly analyzeQueue: ChatboxAnalyzeQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Inject(IntegrationSyncLogService)
    private readonly syncLog: IntegrationSyncLogService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'ChatboxStuckRecoveryCron.recover',
    timeZone: 'Europe/Moscow',
  })
  async recover(): Promise<void> {
    try {
      const enabled = (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) return;

      const stuckMin = await this.resolveStuckMin();
      const stuckBefore = new Date(Date.now() - stuckMin * 60_000);

      const stuckSessions = await this.prisma.chatboxChatSession.findMany({
        where: {
          analysisStatus: 'analyzing',
          updatedAt: { lt: stuckBefore },
        },
        select: { id: true, tenantId: true },
        take: 200,
      });
      if (stuckSessions.length === 0) return;

      const run = await this.syncLog
        .begin({
          tenantId: stuckSessions[0]!.tenantId,
          provider: 'chatbox',
          kind: 'analyze',
          refId: 'stuck-recovery',
        })
        .catch(() => null);
      if (run) {
        await this.syncLog.skip(run, `recovering ${stuckSessions.length} stuck sessions`);
      }

      for (const s of stuckSessions) {
        try {
          await this.analyzeQueue.enqueue(s.tenantId, s.id);
        } catch (err) {
          this.logger.warn(
            { sessionId: s.id, err: err instanceof Error ? err.message : String(err) },
            'stuck-recovery: не удалось re-enqueue',
          );
        }
      }

      this.logger.log(
        `stuck-recovery: re-enqueued=${stuckSessions.length} (stuckMin=${stuckMin})`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'stuck-recovery: глобальная ошибка',
      );
    }
  }

  private async resolveStuckMin(): Promise<number> {
    try {
      const raw = await this.adminSettings.get<number>(
        'chatbox.analyze.stuckAnalyzingMin',
        DEFAULT_STUCK_MIN,
      );
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 1) return DEFAULT_STUCK_MIN;
      return Math.floor(value);
    } catch {
      return DEFAULT_STUCK_MIN;
    }
  }
}
