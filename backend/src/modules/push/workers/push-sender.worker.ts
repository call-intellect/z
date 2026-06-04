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
  type PushSendJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { WebPushSender } from '../services/web-push-sender.service';

/**
 * PushSenderWorker — consumer `core.push-send`. Один job = один user (по
 * подписке worker'а enqueue в `CoreQueueService.enqueuePushSend`).
 *
 * Concurrency 5 — web-push I/O-bound, типичный 1 push = 100–300ms на сетку.
 *
 * Failure-режим:
 *   - 410/404 от push-сервиса — обрабатываются внутри `WebPushSender.sendToUser`
 *     через `markFailure`. Worker сам по себе НЕ выбрасывает исключений на это —
 *     это нормальная ситуация (телефон вышел из сети, браузер unregister'нул SW).
 *   - Любые non-410/404 ошибки логируются. Throw из worker'а → BullMQ retry
 *     по дефолтам очереди (5 попыток с exponential backoff).
 *
 * Метрики (TODO Wave 2.1 финализация): пока только логи; в Prometheus
 * добавим counter `push_send_total{status="delivered|failed|skipped_no_vapid"}`
 * — отдельный sub-task после интеграции в ActivityFeedService.
 */
@Injectable()
export class PushSenderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushSenderWorker.name);
  private worker: Worker<PushSendJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(WebPushSender) private readonly sender: WebPushSender,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<PushSendJobData>(
      CORE_QUEUE_NAMES.PUSH_SEND,
      async (job) =>
        this.pipe.job(SystemLogPipeline.NOTIFICATIONS, 'push.sender', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id,
          userId: job?.data?.userId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'push-send: job failed (повтор по политике BullMQ)',
      );
    });

    this.worker.on('completed', (job) => {
      this.logger.debug(
        { jobId: job.id, userId: job.data.userId },
        'push-send: job completed',
      );
    });

    this.logger.log(
      `PushSenderWorker запущен (${CORE_QUEUE_NAMES.PUSH_SEND}, concurrency=5)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /** Внутренний обработчик job'а — публичный для unit-тестов. */
  async process(job: Job<PushSendJobData>): Promise<void> {
    const { tenantId, userId, title, body, icon, data } = job.data;
    const url =
      data && typeof data === 'object' && typeof data.url === 'string'
        ? data.url
        : undefined;
    const extraData = data ? { ...data } : undefined;
    if (extraData) delete extraData.url;

    const args: {
      tenantId: string;
      userId: string;
      title: string;
      body: string;
      icon?: string;
      url?: string;
      extraData?: Record<string, unknown>;
    } = { tenantId, userId, title, body };
    if (icon !== undefined) args.icon = icon;
    if (url !== undefined) args.url = url;
    if (extraData !== undefined) args.extraData = extraData;

    const result = await this.sender.sendToUser(args);
    this.logger.log(
      {
        jobId: job.id,
        userId,
        tenantId,
        delivered: result.delivered,
        failed: result.failed,
      },
      'push-send: завершён',
    );
  }
}
