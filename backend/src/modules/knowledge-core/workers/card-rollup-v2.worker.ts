import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  type CardRollupV2JobData,
  CORE_QUEUE_NAMES,
} from '../../core-queue/queues';
import { CardRollupV2Service } from '../services/card-rollup-v2.service';

/**
 * CardRollupV2Worker (`core.card-rollup-v2` consumer, Фаза 4).
 *
 * Триггер: `enqueueCardRollupV2(cardId)` (см. CoreQueueService) — после
 * ai_ready встречи в карточке, после link/unlink, после явного regenerate.
 *
 * Логика:
 *   1. Считать `Card`. Если deletedAt — пропуск. Если tenant отсутствует
 *      (legacy NULL) — пропуск (лог).
 *   2. Дёрнуть `CardRollupV2Service.buildRollup` — соберёт блоки + темы,
 *      сделает LLM-вызов.
 *   3. Записать `summaryCache`, `summaryUpdatedAt`, `cachedTopThemeIds` в Card.
 *
 * Concurrency=2 — баланс между параллелизмом и LLM rate-limit'ами.
 *
 * NB: старый `CardRollupWorker` в ai-модуле жив и обрабатывает свою очередь
 * `ai.card-rollup`. Переключение AI-pipeline'а на новый воркер — Фазы 5/6.
 */
@Injectable()
export class CardRollupV2Worker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CardRollupV2Worker.name);
  private worker: Worker<CardRollupV2JobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardRollupV2Service) private readonly svc: CardRollupV2Service,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<CardRollupV2JobData>(
      CORE_QUEUE_NAMES.CARD_ROLLUP_V2,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          cardId: job?.data?.cardId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'card-rollup-v2: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `CardRollupV2Worker запущен (${CORE_QUEUE_NAMES.CARD_ROLLUP_V2})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<CardRollupV2JobData>): Promise<void> {
    const { cardId, reason } = job.data;
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!card) {
      this.logger.debug({ cardId }, 'card-rollup-v2: карточка не найдена — skip');
      return;
    }
    if (card.deletedAt) {
      this.logger.debug({ cardId }, 'card-rollup-v2: карточка удалена — skip');
      return;
    }
    if (!card.tenantId) {
      this.logger.warn(
        { cardId },
        'card-rollup-v2: tenantId=null (legacy) — skip до backfill',
      );
      return;
    }

    const result = await this.svc.buildRollup({
      tenantId: card.tenantId,
      cardId: card.id,
    });

    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        summaryCache: result.summary,
        summaryUpdatedAt: new Date(),
        cachedTopThemeIds: result.topThemeIds,
      },
    });

    this.logger.log(
      {
        cardId,
        reason,
        blocksUsed: result.blocksUsed,
        summaryChars: result.summary?.length ?? 0,
        topThemes: result.topThemeIds.length,
      },
      'card-rollup-v2: done',
    );
  }
}
