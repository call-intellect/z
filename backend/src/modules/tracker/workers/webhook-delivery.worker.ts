import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  TRACKER_QUEUE_NAMES,
  type WebhookDeliveryJobData,
} from '../queues';
import { WebhookSigner } from '../services/webhook-signer.service';

/** HTTP timeout одного запроса. 10s — компромисс между «успеть» и «не висеть». */
const REQUEST_TIMEOUT_MS = 10_000;

/** Максимум, сколько байт ответа храним в IssueWebhookLog (защита от 100MB body). */
const MAX_RESPONSE_BODY_BYTES = 10 * 1024;

/**
 * WebhookDeliveryWorker — consumer очереди `tracker.webhook-delivery`.
 *
 * Поведение:
 *   - Каждая попытка пишется в `IssueWebhookLog` (success или fail).
 *   - При non-2xx или network-error — `throw` → BullMQ ставит retry по
 *     exponential backoff (см. `WEBHOOK_DELIVERY_JOB_OPTIONS`).
 *   - После исчерпания attempts (default 5) — listener `failed` деактивирует
 *     webhook (`isActive=false`) и пишет финальный log с `errorMessage`.
 *
 * Headers:
 *   - `X-Kora-Event: <eventType>`
 *   - `X-Kora-Webhook-Id: <webhookId>`
 *   - `X-Kora-Delivery: <jobId>`
 *   - `X-Kora-Signature: sha256=<hex>` (HMAC-SHA256 от raw body)
 *   - `X-Kora-Timestamp: <enqueuedAt ISO>`
 *
 * Concurrency: 8 — webhook'и I/O-bound (network); процессорно почти ничего.
 */
@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private worker: Worker<WebhookDeliveryJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookSigner) private readonly signer: WebhookSigner,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<WebhookDeliveryJobData>(
      TRACKER_QUEUE_NAMES.WEBHOOK_DELIVERY,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 8,
      },
    );

    // Inc метрики и эскалация при исчерпании attempts.
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attemptsMade = job.attemptsMade ?? 0;
      const attemptsTotal = job.opts.attempts ?? 1;
      if (attemptsMade >= attemptsTotal) {
        // Окончательно. Деактивация + финальная отметка.
        void this.handleFinalFailure(job, err).catch((e) => {
          this.logger.error(
            { jobId: job.id, err: e instanceof Error ? e.message : String(e) },
            'webhook-delivery: handleFinalFailure threw',
          );
        });
      } else {
        // Промежуточная — будет retry.
        this.metrics.incWebhookDelivery({
          event: job.data.eventType,
          status: 'retrying',
        });
      }
    });

    this.worker.on('completed', (job) => {
      this.metrics.incWebhookDelivery({
        event: job.data.eventType,
        status: 'delivered',
      });
    });

    this.logger.log(
      `WebhookDeliveryWorker запущен (${TRACKER_QUEUE_NAMES.WEBHOOK_DELIVERY}, concurrency=8)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главная обработка job'а. При не-2xx ответе или сетевой ошибке — throw,
   * BullMQ запустит retry по backoff'у. Каждая попытка пишется в
   * `IssueWebhookLog` (success + failed).
   */
  private async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { webhookId, tenantId, eventType, payload } = job.data;
    // attemptsMade в bullmq на момент попытки = текущая попытка (1-based для
    // 1й попытки). Используем как retryCount в логе (0-based: первая попытка
    // = 0, retry = 1+).
    const retryCount = Math.max(0, (job.attemptsMade ?? 0));

    const webhook = await this.prisma.issueWebhook.findFirst({
      where: { id: webhookId, tenantId },
    });
    if (!webhook) {
      // Сама запись уже удалена — нет смысла ретраить.
      this.logger.warn(
        { webhookId, tenantId },
        'webhook-delivery: webhook не найден, пропуск',
      );
      return;
    }
    if (!webhook.isActive) {
      this.logger.debug(
        { webhookId, eventType },
        'webhook-delivery: webhook не активен, пропуск',
      );
      return;
    }

    const rawBody = JSON.stringify({
      event: eventType,
      tenantId,
      webhookId: webhook.id,
      enqueuedAt: job.data.enqueuedAt,
      data: payload,
    });
    const signature = this.signer.sign(rawBody, webhook.secretKey);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'Kora-Tracker-Webhook/1.0',
      'x-kora-event': eventType,
      'x-kora-webhook-id': webhook.id,
      'x-kora-delivery': job.id ?? 'unknown',
      'x-kora-signature': signature,
      'x-kora-timestamp': job.data.enqueuedAt,
    };

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let success = false;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: controller.signal,
      });
      responseStatus = response.status;
      const text = await response.text().catch(() => '');
      responseBody = text.slice(0, MAX_RESPONSE_BODY_BYTES);
      success = response.ok;
      if (!success) {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (e) {
      const isAbort =
        e instanceof Error &&
        (e.name === 'AbortError' || e.name === 'TimeoutError');
      errorMessage = isAbort
        ? `timeout ${REQUEST_TIMEOUT_MS}ms`
        : e instanceof Error
          ? e.message
          : 'unknown error';
    } finally {
      clearTimeout(timeoutId);
    }

    const responseTime = Date.now() - startedAt;

    // requestBody — `Json` в схеме (parsed object), requestHeaders — `Json`.
    // responseBody — `String?` (`@db.Text`).
    const parsedRequestBody = JSON.parse(rawBody) as Prisma.InputJsonValue;
    await this.prisma.issueWebhookLog.create({
      data: {
        webhookId: webhook.id,
        eventType,
        requestMethod: 'POST',
        requestUrl: webhook.url,
        requestHeaders: this.sanitizeHeaders(headers) as Prisma.InputJsonValue,
        requestBody: parsedRequestBody,
        responseStatus,
        responseBody,
        responseTime,
        retryCount,
        success,
        errorMessage,
      },
    });

    if (!success) {
      // throw → BullMQ либо retry, либо `failed` event при исчерпании.
      throw new Error(
        `webhook delivery failed: ${errorMessage ?? `HTTP ${responseStatus ?? '???'}`}`,
      );
    }
  }

  /**
   * Финальная неудача (исчерпаны attempts). Деактивируем webhook + TODO
   * уведомление владельцу через ConversationalService (когда модуль будет
   * подключён к TrackerModule).
   */
  private async handleFinalFailure(
    job: Job<WebhookDeliveryJobData>,
    err: Error,
  ): Promise<void> {
    const { webhookId, eventType, tenantId } = job.data;
    this.metrics.incWebhookDelivery({ event: eventType, status: 'failed' });
    this.logger.warn(
      {
        webhookId,
        eventType,
        tenantId,
        attemptsMade: job.attemptsMade,
        err: err.message,
      },
      'webhook-delivery: исчерпан лимит попыток — деактивирую webhook',
    );
    try {
      await this.prisma.issueWebhook.updateMany({
        where: { id: webhookId, tenantId, isActive: true },
        data: { isActive: false },
      });
    } catch (e) {
      this.logger.error(
        { webhookId, err: e instanceof Error ? e.message : String(e) },
        'webhook-delivery: не удалось деактивировать webhook',
      );
    }
    // TODO Sprint 2-3 (см. CLAUDE.md / ConversationalService):
    //   - создать Notification владельцу (`createdByUserId` IssueWebhook)
    //     с текстом «webhook X деактивирован после 5 неудачных попыток»;
    //   - либо отправить email через MailModule.
  }

  /**
   * Чистим headers перед записью в БД — убираем `x-kora-signature` (может
   * пригодиться при перепроигрывании, но и raw body есть; signature можно
   * посчитать). Оставим всё, кроме явно секретного — secret в headers нет,
   * sig сохраняем для отладки.
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    // На текущий момент в headers нет ничего секретного (secret не уходит
    // в заголовках). Возвращаем как есть; функция-обёртка оставлена для
    // будущего расширения.
    return { ...headers };
  }
}
