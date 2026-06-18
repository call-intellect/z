import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type RebuildSkillProfileJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { Specialist37Service } from '../services/specialist-3-7-skill.service';

@Injectable()
export class SkillProfileRebuildWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillProfileRebuildWorker.name);
  private worker: Worker<RebuildSkillProfileJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Specialist37Service)
    private readonly specialist: Specialist37Service,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RebuildSkillProfileJobData>(
      CORE_QUEUE_NAMES.SKILL_PROFILE_REBUILD,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.skill-profile-rebuild', job, () =>
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
          profileId: job?.data?.profileId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'skill-profile-rebuild: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.debug(
      `SkillProfileRebuildWorker запущен (${CORE_QUEUE_NAMES.SKILL_PROFILE_REBUILD})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<RebuildSkillProfileJobData>): Promise<void> {
    const { profileId, tenantId, reason } = job.data;
    this.logger.debug({ profileId, tenantId, reason }, 'skill-profile-rebuild: start');
    await this.specialist.rebuildProfile({ profileId });
  }
}
