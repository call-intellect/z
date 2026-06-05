import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

/** Сколько pending-сессий забираем за один проход sweeper'а. */
const SWEEP_BATCH = 200;

/**
 * Cron-sweeper анализа закрытых сессий ChatBox (ТЗ 2026-06-05, Фаза 5).
 *
 * Каждые 5 минут добирает закрытые сессии (`endedAt != null`) со статусом
 * `pending` и ставит на них job анализа через ChatboxAnalyzeQueueService.
 * Дедуп по jobId схлопнёт повторы (сессия уже в очереди). Подстраховка на
 * случай, если producer (webhook/синк) не поставил job сразу.
 *
 * Kill-switch `chatbox.enabled` (admin settings) глушит проход. Тело обёрнуто
 * в try/catch — cron не должен падать.
 */
@Injectable()
export class ChatboxAnalyzeCron {
  private readonly logger = new Logger(ChatboxAnalyzeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly queue: ChatboxAnalyzeQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug('analyze-sweep: chatbox.enabled=false — пропуск');
        return;
      }

      const sessions = await this.prisma.chatboxChatSession.findMany({
        where: { analysisStatus: 'pending', endedAt: { not: null } },
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

      this.logger.log(
        `analyze-sweep: pending=${sessions.length} enqueued=${enqueued}`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'analyze-sweep: глобальная ошибка прохода',
      );
    }
  }
}
