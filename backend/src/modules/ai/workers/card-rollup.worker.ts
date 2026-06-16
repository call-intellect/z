import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type CardRollupJobData, QUEUE_NAMES } from '../queues';
import { CardRollupService } from '../services/card-rollup.service';

@Injectable()
export class CardRollupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CardRollupWorker.name);
  private worker: Worker<CardRollupJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CardRollupService) private readonly svc: CardRollupService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<CardRollupJobData>(
      QUEUE_NAMES.CARD_ROLLUP,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'ai.card-rollup', job, () =>
          this.process(job),
        ),
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
        'card-rollup: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(`CardRollupWorker запущен (${QUEUE_NAMES.CARD_ROLLUP})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<CardRollupJobData>): Promise<void> {
    const { cardId, reason } = job.data;
    this.logger.debug({ cardId, reason }, 'card-rollup: start');
    await this.svc.rollupCard(cardId);
  }
}
