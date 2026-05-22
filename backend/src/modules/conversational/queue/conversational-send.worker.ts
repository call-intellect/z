import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { NotificationDelivery, NotificationStatus } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ChannelRegistry } from '../channel-registry';

import {
  CONVERSATIONAL_SEND_QUEUE,
  type ConversationalSendJobData,
} from './conversational-queue';
import { ConversationalQueueService } from './conversational-queue.service';

/**
 * Worker очереди `conversational.send`.
 *
 * Алгоритм для одного job:
 *   1. Загрузить `NotificationDelivery + Notification + Binding + Channel`.
 *   2. Если delivery уже завершён (delivered/responded/read/failed) — no-op.
 *   3. Получить адаптер канала через `ChannelRegistry`.
 *   4. Вызвать `adapter.send(...)`.
 *   5. На успех — `status='delivered'`, обновить `attempts`, агрегировать
 *      `Notification.status`.
 *   6. На исключение — `attempts++`, если меньше `maxDeliveryAttempts` —
 *      enqueue retry с exp backoff (cap 1ч). Иначе — `status='failed'`,
 *      агрегировать `Notification.status`.
 *
 * Особенность InApp: канал реально ничего не отправляет — send'хватает,
 * и доставка сразу `delivered`. Это правильно: UI читает Notification из БД.
 */
const RETRY_BACKOFF_CAP_MS = 60 * 60 * 1000;
const MAX_ERROR_REASON_LENGTH = 1024;

@Injectable()
export class ConversationalSendWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationalSendWorker.name);
  private worker: Worker<ConversationalSendJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(ConversationalQueueService)
    private readonly queue: ConversationalQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ConversationalSendJobData>(
      CONVERSATIONAL_SEND_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: this.cfg.conversational.outboundConcurrency,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'ConversationalSendWorker: job failed (BullMQ-side)',
      );
    });
    this.logger.log(
      `ConversationalSendWorker запущен (concurrency=${this.cfg.conversational.outboundConcurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<ConversationalSendJobData>): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: {
        notification: true,
        channelBinding: { include: { channel: true } },
      },
    });
    if (!delivery) {
      this.logger.warn(
        `delivery=${job.data.deliveryId} не найден (возможно, удалён retention/cascadeDelete)`,
      );
      return;
    }
    if (
      delivery.status === 'delivered' ||
      delivery.status === 'failed' ||
      delivery.status === 'responded' ||
      delivery.status === 'read'
    ) {
      this.logger.debug(
        `delivery=${delivery.id} уже завершён (${delivery.status}) — skip`,
      );
      return;
    }

    const adapter = this.registry.get(delivery.channelBinding.channel.kind);
    if (!adapter) {
      const reason = `no_adapter_for_kind:${delivery.channelBinding.channel.kind}`;
      this.logger.error(`delivery=${delivery.id}: ${reason}`);
      await this.markDeliveryFailed({ delivery, errorReason: reason });
      await this.recomputeNotificationStatus(delivery.notificationId);
      return;
    }

    try {
      const result = await adapter.send({
        delivery,
        notification: delivery.notification,
        binding: delivery.channelBinding,
        channel: delivery.channelBinding.channel,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'delivered',
          attempts: { increment: 1 },
          deliveredAt: new Date(),
          externalMessageId: result.externalMessageId,
          errorReason: null,
        },
      });
      this.metrics.incConversationalDelivery({
        kind: delivery.channelBinding.channel.kind,
        status: 'delivered',
      });
      await this.recomputeNotificationStatus(delivery.notificationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newAttempts = delivery.attempts + 1;
      const max = this.cfg.conversational.maxDeliveryAttempts;
      if (newAttempts < max) {
        // Backoff: 2^attempts × 1s, потолок 1ч.
        const delayMs = Math.min(2 ** newAttempts * 1000, RETRY_BACKOFF_CAP_MS);
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts: { increment: 1 },
            errorReason: message.slice(0, MAX_ERROR_REASON_LENGTH),
          },
        });
        await this.queue.enqueueSend({
          deliveryId: delivery.id,
          attempt: newAttempts,
          delayMs,
        });
        this.metrics.incConversationalDelivery({
          kind: delivery.channelBinding.channel.kind,
          status: 'retrying',
        });
        this.logger.debug(
          `delivery=${delivery.id} retry attempt=${newAttempts}/${max} delayMs=${delayMs}`,
        );
        return;
      }
      // Финальный провал.
      await this.markDeliveryFailed({ delivery, errorReason: message });
      await this.recomputeNotificationStatus(delivery.notificationId);
    }
  }

  private async markDeliveryFailed(args: {
    delivery: NotificationDelivery;
    errorReason: string;
  }): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: args.delivery.id },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        errorReason: args.errorReason.slice(0, MAX_ERROR_REASON_LENGTH),
      },
    });
    this.metrics.incConversationalDelivery({
      kind: 'unknown',
      status: 'failed',
    });
  }

  /**
   * Пересчёт `Notification.status` по агрегату deliveries:
   *   - все failed   → failed
   *   - все delivered/+ читаемо/responded → delivered/read/responded
   *   - часть delivered, часть queued → sent_partial
   *   - все queued → queued (без изменений)
   */
  private async recomputeNotificationStatus(notificationId: string): Promise<void> {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: { notificationId },
      select: { status: true },
    });
    if (deliveries.length === 0) return;

    const statuses = new Set(deliveries.map((d) => d.status));
    const next: NotificationStatus = (() => {
      if (statuses.has('responded')) return 'responded';
      if (statuses.has('read')) return 'read';
      if (statuses.has('delivered') && statuses.size === 1) return 'delivered';
      if (statuses.has('delivered')) return 'sent_partial';
      if (statuses.size === 1 && statuses.has('failed')) return 'failed';
      if (statuses.size === 1 && statuses.has('queued')) return 'queued';
      return 'sent_partial';
    })();

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: next },
    });
    this.metrics.incConversationalNotification({
      eventType: updated.eventType,
      status: next,
    });
  }
}
