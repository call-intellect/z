import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { RedisService } from '../../common/redis/redis.service';
import { EncryptionService } from '../security/encryption.service';
import { SsrfGuardService } from '../security/ssrf-guard.service';

import { SubscriptionsRepository } from './subscriptions.repository';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookSigningService } from './webhook-signing.service';
import {
  WEBHOOK_DELIVERY_QUEUE,
  type WebhookDeliveryJobData,
} from './webhook-queue';

/**
 * Worker очереди `webhook.delivery`.
 *
 * Алгоритм для одного job:
 *   1. Загрузить `WebhookDelivery + Subscription`.
 *   2. SSRF-гвард на URL (защита от DNS-rebinding между create и delivery).
 *   3. decrypt(secret), посчитать `X-Z-Signature` через `WebhookSigningService`.
 *   4. POST с timeout = `cfg.webhooksOut.deliveryTimeoutMs`.
 *   5. На 2xx — status='delivered', метрика {status:'delivered'},
 *      `Subscription.lastDeliveryAt = now`.
 *   6. На non-2xx или сетевую ошибку:
 *      - attempts++,
 *      - если attempts < `maxAttempts`: status='retrying',
 *        nextAttemptAt = now + 2^attempts s (cap 1ч), enqueue retry с delay,
 *      - иначе: status='failed', метрика {status:'failed'},
 *        если 5+ failed подряд — `Subscription.status='failing'`.
 */
const MAX_RESPONSE_BODY_BYTES = 1024;
const RETRY_BACKOFF_CAP_MS = 60 * 60 * 1000; // 1 час

@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private worker: Worker<WebhookDeliveryJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SubscriptionsRepository) private readonly repo: SubscriptionsRepository,
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(SsrfGuardService) private readonly ssrf: SsrfGuardService,
    @Inject(WebhookSigningService) private readonly signer: WebhookSigningService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<WebhookDeliveryJobData>(
      WEBHOOK_DELIVERY_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 5,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'WebhookDeliveryWorker: job failed (BullMQ-side)',
      );
    });
    this.logger.log(`WebhookDeliveryWorker запущен (${WEBHOOK_DELIVERY_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const delivery = await this.repo.findDelivery(job.data.deliveryId);
    if (!delivery) {
      this.logger.warn(
        `delivery=${job.data.deliveryId} не найден (возможно, удалён retention)`,
      );
      return;
    }
    if (delivery.status === 'delivered' || delivery.status === 'failed') {
      this.logger.debug(`delivery=${delivery.id} уже завершён (${delivery.status})`);
      return;
    }

    const subscription = await this.repo.findById(delivery.subscriptionId);
    if (!subscription) {
      this.logger.warn(`subscription=${delivery.subscriptionId} удалена; помечаем delivery failed`);
      await this.repo.updateDelivery(delivery.id, { status: 'failed' });
      return;
    }

    // SSRF-проверка перед каждым fetch (защита от DNS-rebinding).
    try {
      await this.ssrf.assertSafeOutboundUrl(subscription.url);
    } catch (err) {
      this.logger.warn(
        { deliveryId: delivery.id, err: err instanceof Error ? err.message : String(err) },
        'SSRF-блок: пометка delivery failed',
      );
      await this.repo.updateDelivery(delivery.id, {
        status: 'failed',
        attempts: { increment: 1 },
        lastResponse: 'ssrf_blocked',
      });
      this.metrics?.incWebhookDelivery({ event: delivery.event, status: 'failed' });
      return;
    }

    const secret = (() => {
      try {
        return this.encryption.decrypt(subscription.secretEncrypted);
      } catch {
        return null;
      }
    })();
    if (!secret) {
      this.logger.error(`delivery=${delivery.id}: не удалось расшифровать secret`);
      await this.repo.updateDelivery(delivery.id, {
        status: 'failed',
        lastResponse: 'secret_decryption_failed',
      });
      this.metrics?.incWebhookDelivery({ event: delivery.event, status: 'failed' });
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const signatureHeader = this.signer.sign({ secret, rawBody: body });
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'Z-Webhooks/1.0',
      'x-z-signature': signatureHeader,
      'x-z-event-id': delivery.eventId,
      'x-z-delivery-id': delivery.id,
      'x-z-event-type': delivery.event,
    };

    const timeoutMs = this.cfg.webhooksOut.deliveryTimeoutMs;
    let httpStatus: number | null = null;
    let respText = '';
    let networkError: string | null = null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(subscription.url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: ac.signal,
      });
      httpStatus = res.status;
      // Ограничиваем размер тела ответа.
      const text = await res.text().catch(() => '');
      respText = text.slice(0, MAX_RESPONSE_BODY_BYTES);
    } catch (err) {
      networkError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    const isSuccess = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
    if (isSuccess) {
      await this.repo.updateDelivery(delivery.id, {
        status: 'delivered',
        attempts: { increment: 1 },
        lastStatus: httpStatus,
        lastResponse: respText || null,
        deliveredAt: new Date(),
      });
      await this.repo.updateStatus(subscription.id, { lastDeliveryAt: new Date() });
      this.metrics?.incWebhookDelivery({ event: delivery.event, status: 'delivered' });
      return;
    }

    // Неуспех — оцениваем retry.
    const newAttempts = delivery.attempts + 1;
    const maxAttempts = this.cfg.webhooksOut.maxAttempts;
    const responseSummary = networkError
      ? `network_error:${networkError}`
      : `http_${httpStatus ?? 'unknown'}:${respText}`;

    if (newAttempts < maxAttempts) {
      const delayMs = Math.min(2 ** newAttempts * 1000, RETRY_BACKOFF_CAP_MS);
      const nextAttemptAt = new Date(Date.now() + delayMs);
      await this.repo.updateDelivery(delivery.id, {
        status: 'retrying',
        attempts: { increment: 1 },
        lastStatus: httpStatus,
        lastResponse: responseSummary.slice(0, MAX_RESPONSE_BODY_BYTES),
        nextAttemptAt,
      });
      await this.dispatcher.enqueueRetry(delivery.id, delayMs);
      this.metrics?.incWebhookDelivery({ event: delivery.event, status: 'retrying' });
      this.logger.debug(
        `delivery=${delivery.id} retry attempt=${newAttempts}/${maxAttempts} delay=${delayMs}ms`,
      );
      return;
    }

    // Финальный fail.
    await this.repo.updateDelivery(delivery.id, {
      status: 'failed',
      attempts: { increment: 1 },
      lastStatus: httpStatus,
      lastResponse: responseSummary.slice(0, MAX_RESPONSE_BODY_BYTES),
    });
    this.metrics?.incWebhookDelivery({ event: delivery.event, status: 'failed' });

    // Авто-переход подписки в failing на 5+ failed подряд.
    const failedCount = await this.repo.countConsecutiveFailed(subscription.id);
    if (failedCount >= 5 && subscription.status === 'active') {
      await this.repo.updateStatus(subscription.id, { status: 'failing' });
      this.logger.warn(
        `subscription=${subscription.id} переведена в failing (${failedCount} failed подряд)`,
      );
    }
  }
}
