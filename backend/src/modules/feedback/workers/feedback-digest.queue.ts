/**
 * FeedbackDigestQueue — BullMQ-очередь ночного AI-прогона канала «Ваши
 * предложения». Создаётся ОДНА на процесс (паттерн как у CoreQueueService /
 * RecognitionFormulateWorker — `new Queue(...)` в `onModuleInit`).
 *
 * Имя очереди: `core.feedback-digest`. Префикс `core.` — для консистентности
 * с другими knowledge-core очередями. На очередь подписан
 * `FeedbackDigestWorker` (consumer); producer'ы — `FeedbackDigestCron` (по
 * расписанию 01:00 UTC) и ручной enqueue из `POST /admin/feedback/digest/run`.
 *
 * Идемпотентность:
 *   - cron-job  — jobId = `feedback-digest-cron-<YYYYMMDD>` (один в сутки).
 *   - manual    — jobId = `feedback-digest-manual-<timestamp>` (уникальный
 *                  на каждый клик «Запустить сейчас» в админке).
 *
 * Внутри самого `runDigest` дополнительная защита — Redis-lock
 * `feedback:digest:lock` (TTL 30 минут), см. FeedbackDigestService.
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
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

/**
 * Имя BullMQ-очереди. Экспортируется константой, чтобы worker и cron
 * использовали один и тот же литерал (без рассинхрона).
 */
export const FEEDBACK_DIGEST_QUEUE_NAME = 'core.feedback-digest' as const;

/**
 * Полезная нагрузка job'а. Пустая — все параметры пакета (BATCH_SIZE и т.д.)
 * читаются на стороне consumer'а из ENV / констант.
 *
 * `triggeredBy` — для логов и метрик (откуда пришёл запуск).
 */
export interface FeedbackDigestJobData {
  triggeredBy: 'cron' | 'manual';
}

/**
 * Дефолтные опции job'ов. 1 attempts — потому что внутри `runDigest`
 * уже есть собственный retry-chain (две попытки + fallback цепочка LlmRouter).
 * Если runDigest бросил — значит и попытка 1, и попытка 2 не справились,
 * BullMQ-уровневый retry уже не поможет. Сообщения и так получат
 * `failedRuns++` — следующий cron подхватит.
 */
const FEEDBACK_DIGEST_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: false,
};

@Injectable()
export class FeedbackDigestQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackDigestQueue.name);
  private queue: Queue<FeedbackDigestJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<FeedbackDigestJobData>(FEEDBACK_DIGEST_QUEUE_NAME, {
      connection: this.redis.client,
      defaultJobOptions: FEEDBACK_DIGEST_DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(
      `FeedbackDigestQueue инициализирован (${FEEDBACK_DIGEST_QUEUE_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии очереди ${FEEDBACK_DIGEST_QUEUE_NAME}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      this.queue = null;
    }
  }

  /**
   * Прямой доступ к BullMQ-очереди (для редких кейсов admin-инструментов).
   * Большинство callers должны использовать `enqueueManualRun` /
   * `enqueueCronRun`.
   */
  get raw(): Queue<FeedbackDigestJobData> {
    if (!this.queue) {
      throw new Error(
        'FeedbackDigestQueue: используется до onModuleInit (queue=null)',
      );
    }
    return this.queue;
  }

  /**
   * Ручной запуск из админки (`POST /admin/feedback/digest/run`).
   * jobId уникален по timestamp — кнопка «Запустить сейчас» каждый раз
   * создаёт новый job (если предыдущий ещё работает — Redis-lock внутри
   * runDigest предотвратит реальный двойной запуск).
   */
  async enqueueManualRun(): Promise<{ jobId: string }> {
    const jobId = `feedback-digest-manual-${Date.now()}`;
    await this.raw.add('run', { triggeredBy: 'manual' }, { jobId });
    this.logger.debug({ jobId }, 'feedback-digest: enqueue manual run');
    return { jobId };
  }

  /**
   * Запуск из cron'а. jobId — дневной (UTC), благодаря чему повторный enqueue
   * в течение тех же суток не создаст дубль (например, если cron сработал
   * дважды из-за гонки запуска воркеров).
   */
  async enqueueCronRun(now: Date = new Date()): Promise<{ jobId: string }> {
    const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
    const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = now.getUTCDate().toString().padStart(2, '0');
    const jobId = `feedback-digest-cron-${yyyy}${mm}${dd}`;
    await this.raw.add('run', { triggeredBy: 'cron' }, { jobId });
    this.logger.debug({ jobId }, 'feedback-digest: enqueue cron run');
    return { jobId };
  }
}
