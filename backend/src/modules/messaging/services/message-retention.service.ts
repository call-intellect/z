import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { ChatIngestService } from './chat-ingest.service';

@Injectable()
export class MessageRetentionService {
  private readonly logger = new Logger(MessageRetentionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatIngestService) private readonly chatIngest: ChatIngestService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async sweepExpired(now: Date = new Date()): Promise<{ ingested: number; deleted: number }> {
    const days = await this.cfg.getDynamic<number>('message_retention_days', undefined, 0);
    if (days <= 0) {
      return { ingested: 0, deleted: 0 };
    }

    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const batchSize = this.cfg.retention.sweepBatchSize;

    let ingested = 0;
    let deleted = 0;

    for (;;) {
      const candidates = await this.prisma.message.findMany({
        where: { deletedAt: null, createdAt: { lt: cutoff } },
        select: { id: true, conversationId: true },
        take: batchSize,
      });
      if (candidates.length === 0) break;

      const feedsGraphCache = new Map<string, boolean>();

      for (const message of candidates) {
        try {
          let feedsGraph = feedsGraphCache.get(message.conversationId);
          if (feedsGraph === undefined) {
            const conversation = await this.prisma.conversation.findUnique({
              where: { id: message.conversationId },
              select: { feedsGraph: true },
            });
            feedsGraph = conversation?.feedsGraph ?? false;
            feedsGraphCache.set(message.conversationId, feedsGraph);
          }

          if (feedsGraph) {
            await this.chatIngest.ingestMessage(message.id);
            ingested += 1;
          }

          await this.prisma.message.update({
            where: { id: message.id },
            data: { deletedAt: now },
          });
          deleted += 1;
          this.metrics.incCoreRetentionDeleted({ kind: 'chat_message' });
        } catch (err) {
          this.logger.warn(
            {
              messageId: message.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'message-retention: ошибка обработки сообщения',
          );
        }
      }

      if (candidates.length < batchSize) break;
    }

    if (ingested > 0 || deleted > 0) {
      this.logger.log({ ingested, deleted, days }, 'message-retention: проход завершён');
    }
    return { ingested, deleted };
  }
}
