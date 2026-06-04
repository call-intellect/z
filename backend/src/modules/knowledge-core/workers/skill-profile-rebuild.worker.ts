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
  type RebuildSkillProfileJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { Specialist37Service } from '../services/specialist-3-7-skill.service';

/**
 * SBA γ-1 — SkillProfileRebuildWorker.
 *
 * Consumer очереди `core.skill-profile-rebuild` (jobName='rebuild-skill-profile').
 * Один job на один профиль — собирает subject-reasoning блоки, KNN-группировка,
 * LLM-detect, KNN-merge с активными, decay, метрики, probe-events.
 *
 * Идемпотентность: jobId = `skill-profile-rebuild_<profileId>`. Несколько подряд
 * идущих enqueue для одного профиля сложатся в один отложенный job (BullMQ
 * + debounce).
 *
 * concurrency=1 — rebuild дорогой (до 12 LLM-вызовов skill-trait-detect
 * + до 12 skill-trait-merge), параллельный шквал одной Org выжрет LLM-квоты.
 */
@Injectable()
export class SkillProfileRebuildWorker
  implements OnModuleInit, OnModuleDestroy
{
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
    this.logger.log(
      `SkillProfileRebuildWorker запущен (${CORE_QUEUE_NAMES.SKILL_PROFILE_REBUILD})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(
    job: Job<RebuildSkillProfileJobData>,
  ): Promise<void> {
    const { profileId, tenantId, reason } = job.data;
    this.logger.debug(
      { profileId, tenantId, reason },
      'skill-profile-rebuild: start',
    );
    await this.specialist.rebuildProfile({ profileId });
  }
}
