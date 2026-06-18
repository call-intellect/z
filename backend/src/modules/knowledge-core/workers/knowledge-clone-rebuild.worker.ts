import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type RebuildKnowledgeProfileJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { Specialist32Service } from '../services/specialist-3-2-knowledge-clone.service';

@Injectable()
export class KnowledgeCloneRebuildWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeCloneRebuildWorker.name);
  private worker: Worker<RebuildKnowledgeProfileJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Specialist32Service)
    private readonly specialist: Specialist32Service,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RebuildKnowledgeProfileJobData>(
      CORE_QUEUE_NAMES.KNOWLEDGE_CLONE_REBUILD,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.knowledge-clone-rebuild', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          personId: job?.data?.personId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'knowledge-clone-rebuild: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.debug(
      `KnowledgeCloneRebuildWorker запущен (${CORE_QUEUE_NAMES.KNOWLEDGE_CLONE_REBUILD})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<RebuildKnowledgeProfileJobData>): Promise<void> {
    const { personId, tenantId, reason } = job.data;
    this.logger.debug({ personId, tenantId, reason }, 'knowledge-clone-rebuild: start');
    await this.specialist.rebuildForPerson({ tenantId, personId });
  }
}
