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
  type RoleProfileJobData,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { RoleProfileService } from '../../role-profiles/services/role-profile.service';

const WORKER_NAME = 'role-profile';

/**
 * RoleProfileWorker (Фаза 0d, см. plans/tz/2026-05-21-phase-0d-role-profile-agent.md §4).
 *
 * Consumer очереди `core.role-profile`. Один job =
 * `{ tenantId, roleId, triggerReason, triggeredByUserId? }`.
 *
 * Concurrency = 1 (LLM-вызовы дороги; parallel не даёт прироста при cron-режиме).
 * Idempotency через jobId = `role_profile_<roleId>_v<buildVersion>` — повторный
 * enqueue в течение коротких интервалов не создаёт дубликат job'а.
 *
 * При фейле — BullMQ retry с exponential backoff (5 attempts). После 3 retry —
 * `RoleProfile.status='error'` (выставляется в `RoleProfileService.build`).
 *
 * WorkerOrgGate: проверяет `Org.workersEnabled['role-profile'] !== false` —
 * Org-Admin может приостановить агент через UI.
 */
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
    this.logger.log(
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

    // Org-Admin тумблер.
    await this.gate.checkOrThrow(tenantId, WORKER_NAME);

    this.logger.log(
      { tenantId, roleId, triggerReason, jobId: job.id },
      'role-profile.worker: старт сборки',
    );

    const result = await this.service.build({ tenantId, roleId, triggerReason });

    this.logger.log(
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
      // Бросаем — BullMQ retry с exponential backoff (см. CORE_DEFAULT_JOB_OPTIONS).
      throw new Error('role-profile build failed (LLM/parse)');
    }
  }
}
