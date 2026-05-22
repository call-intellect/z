import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA α-5 — Cron auto-archive диалогов chat-v2.
 *
 * Раз в неделю (по умолчанию вс 03:00 — `CHAT_V2_CLEANUP_CRON`) проходит
 * по всем active-диалогам с `updatedAt < now - TTL дней` (default 90),
 * `pinnedAt IS NULL` и переводит в `status='archived'`. Не удаляет физически.
 *
 * Pinned диалоги исключаются — пользователь явно сказал «храню».
 */
@Injectable()
export class ChatV2CleanupCron {
  private readonly logger = new Logger(ChatV2CleanupCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // NB: ScheduleModule.Cron не поддерживает динамическое имя из ENV
  // напрямую — на α-5 захардкодим default. Изменение требует рестарта.
  @Cron('0 3 * * 0', { name: 'chat-v2-cleanup' })
  async runCleanup(): Promise<void> {
    const ttlDays = this.cfg.chatV2.conversationTtlDays;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    this.logger.log(
      { ttlDays, cutoff: cutoff.toISOString() },
      'ChatV2CleanupCron: starting auto-archive sweep',
    );

    const result = await this.prisma.chatV2Conversation.updateMany({
      where: {
        status: 'active',
        pinnedAt: null,
        updatedAt: { lt: cutoff },
      },
      data: { status: 'archived' },
    });

    if (result.count > 0) {
      for (let i = 0; i < result.count; i++) {
        this.metrics.incChatV2ConversationArchived({ reason: 'ttl' });
      }
      this.logger.log(
        { archived: result.count },
        'ChatV2CleanupCron: auto-archived conversations',
      );
    } else {
      this.logger.debug('ChatV2CleanupCron: ничего не архивировано');
    }
  }
}
