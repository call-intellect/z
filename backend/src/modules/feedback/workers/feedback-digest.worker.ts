/**
 * FeedbackDigestWorker — consumer BullMQ-очереди `core.feedback-digest`.
 *
 * На каждый job (cron 01:00 UTC или ручной из админки) дёргает
 * `FeedbackDigestService.runDigest()`. Сам worker «тонкий» — всю бизнес-
 * логику держит сервис, чтобы её можно было unit-тестить без BullMQ.
 *
 * Concurrency=1: одновременный запуск двух прогонов не имеет смысла
 * (Redis-lock внутри `runDigest` всё равно их сериализует). Один процессор
 * на инстанс — проще и предсказуемее.
 *
 * Создание Worker'а — стандартный паттерн Z (`new Worker(...)` в
 * `onModuleInit`, см. `RecognitionFormulateWorker` / `BlockIngestWorker`).
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md §«BullMQ-воркер».
 */

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
import { FeedbackDigestService } from '../services/feedback-digest.service';

import {
  FEEDBACK_DIGEST_QUEUE_NAME,
  type FeedbackDigestJobData,
} from './feedback-digest.queue';

@Injectable()
export class FeedbackDigestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackDigestWorker.name);
  private worker: Worker<FeedbackDigestJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(FeedbackDigestService)
    private readonly digest: FeedbackDigestService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<FeedbackDigestJobData>(
      FEEDBACK_DIGEST_QUEUE_NAME,
      async (job) =>
        this.pipe.job(SystemLogPipeline.NOTIFICATIONS, 'feedback.digest', job, () =>
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
          jobId: job?.id ?? 'unknown',
          triggeredBy: job?.data?.triggeredBy ?? 'unknown',
          err: err instanceof Error ? err.message : String(err),
        },
        'feedback-digest job failed',
      );
    });
    this.logger.log(
      `FeedbackDigestWorker запущен (${FEEDBACK_DIGEST_QUEUE_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии worker'а: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        this.worker = null;
      }
    }
  }

  private async process(job: Job<FeedbackDigestJobData>): Promise<void> {
    const triggeredBy = job.data.triggeredBy ?? 'unknown';
    this.logger.log(
      { jobId: job.id, triggeredBy },
      'feedback-digest: starting run',
    );
    const result = await this.digest.runDigest();
    this.logger.log(
      { jobId: job.id, triggeredBy, ...result },
      'feedback-digest: run finished',
    );
  }
}
