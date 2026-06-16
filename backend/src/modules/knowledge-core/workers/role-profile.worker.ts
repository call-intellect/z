import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type RoleProfileJobData } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { RoleProfileService } from '../../role-profiles/services/role-profile.service';

const WORKER_NAME = 'role-profile';

@Injectable()
export class RoleProfileWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoleProfileWorker.name);
  private worker: Worker<RoleProfileJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RoleProfileService)
    private readonly service: RoleProfileService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RoleProfileJobData>(
      CORE_QUEUE_NAMES.ROLE_PROFILE,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.role-profile', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id,
          roleId: job?.data?.roleId,
          attempts: job?.attemptsMade,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-profile.worker: job failed',
      );
    });
    this.logger.debug(
      `RoleProfileWorker запущен (${CORE_QUEUE_NAMES.ROLE_PROFILE}, concurrency=1)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<RoleProfileJobData>): Promise<void> {
    const { tenantId, roleId, triggerReason } = job.data;

    await this.gate.checkOrThrow(tenantId, WORKER_NAME);

    this.logger.debug(
      { tenantId, roleId, triggerReason, jobId: job.id },
      'role-profile.worker: старт сборки',
    );

    const result = await this.service.build({ tenantId, roleId, triggerReason });

    this.logger.debug(
      {
        tenantId,
        roleId,
        status: result.status,
        skipReason: result.skipReason,
        blocksCount: result.blocksCount,
        durationMs: result.durationMs,
      },
      'role-profile.worker: завершено',
    );

    if (result.status === 'failed') {
      throw new Error('role-profile build failed (LLM/parse)');
    }
  }
}
