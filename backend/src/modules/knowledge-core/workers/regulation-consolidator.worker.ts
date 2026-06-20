import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type RegulationConsolidatorJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { RegulationConsolidatorService } from '../services/regulation-consolidator.service';

type ConsolType = 'regulation' | 'process' | 'policy' | 'instruction';

@Injectable()
export class RegulationConsolidatorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegulationConsolidatorWorker.name);
  private worker: Worker<RegulationConsolidatorJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RegulationConsolidatorService)
    private readonly consolidator: RegulationConsolidatorService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RegulationConsolidatorJobData>(
      CORE_QUEUE_NAMES.REGULATION_CONSOLIDATOR,
      async (job) =>
        this.pipe.job(
          SystemLogPipeline.KNOWLEDGE_GRAPH,
          'kc.regulation-consolidator',
          job,
          () => this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.logger.debug(
      `RegulationConsolidatorWorker запущен (${CORE_QUEUE_NAMES.REGULATION_CONSOLIDATOR})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<RegulationConsolidatorJobData>): Promise<void> {
    const { type, cardId } = job.data;
    try {
      const outcome = await this.consolidator.consolidateCard(type as ConsolType, cardId);
      this.logger.debug(
        { type, cardId, outcome },
        'regulation-consolidator: карточка обработана',
      );
    } catch (err) {
      this.logger.warn(
        {
          type,
          cardId,
          err: err instanceof Error ? err.message : String(err),
        },
        'regulation-consolidator: обработка карточки упала',
      );
    }
  }
}
