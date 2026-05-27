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
  type SprintHelperJobData,
} from '../../core-queue/queues';
import { SprintHelperService } from '../services/sprint-helper.service';

/**
 * Sprints (2026-05-27) — Specialist 3-13 «Помощник по спринтам» worker.
 *
 * Consumer очереди `core.specialist-routing` с jobName='3-13-sprint-helper'.
 * Concurrency=1 (один LLM-вызов на спринт, тяжёлый prompt + JSON Schema).
 * jobId дедуп — `3-13-sprint-helper_<cycleId>` (в CoreQueueService).
 *
 * Делегирует логику в `SprintHelperService.runForCycle`.
 */
@Injectable()
export class SprintHelperWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SprintHelperWorker.name);
  private worker: Worker<SprintHelperJobData> | null = null;

  static readonly JOB_NAME = '3-13-sprint-helper';

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SprintHelperService) private readonly svc: SprintHelperService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SprintHelperJobData>(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          cycleId: job?.data?.cycleId,
          jobName: job?.name,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'sprint-helper: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `SprintHelperWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${SprintHelperWorker.JOB_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SprintHelperJobData>): Promise<void> {
    if (job.name !== SprintHelperWorker.JOB_NAME) return;
    const { cycleId, tenantId, reason = 'cron' } = job.data;
    if (!cycleId || !tenantId) return;
    try {
      const { created, reused } = await this.svc.runForCycle({
        cycleId,
        tenantId,
        reason,
      });
      this.logger.log(
        { cycleId, tenantId, reason, created, reused },
        `sprint-helper: завершено — создано ${created}, повтор ${reused}`,
      );
    } catch (err) {
      // SprintHelperService уже не бросает — на всякий случай ловим.
      this.logger.error(
        {
          cycleId,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-helper: неожиданная ошибка',
      );
    }
  }
}
