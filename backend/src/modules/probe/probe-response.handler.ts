import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';

import type { NotificationRespondedPayload } from './probe.types';

/**
 * SBA β-5 — обработчик `notification.responded`.
 *
 * Слушает события `notification.responded`, эмиттированные
 * `ConversationalService.respondToProbe`. Если eventType начинается с
 * 'probe.' — обновляет соответствующий `ProbeEvent.dispatchedAt` /
 * responded-state (через метрики) и эмитит business-метрики
 * `probe_response_total`, `probe_response_time_seconds`.
 *
 * SBA β-5 closing-loop (sub-TZ 2026-05-23) — дополнительно создаёт
 * `RawEvent(kind='notification_response')` через `ConversationalIngestAdapter`,
 * чтобы ответ пользователя попал обратно в knowledge-core pipeline.
 * Связь с исходной `Notification` — через `payload.respondsToNotificationId`.
 */
@Injectable()
export class ProbeResponseHandler {
  private readonly logger = new Logger(ProbeResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalIngestAdapter)
    private readonly ingestAdapter: ConversationalIngestAdapter,
  ) {}

  @OnEvent('notification.responded')
  async handle(event: NotificationRespondedPayload): Promise<void> {
    try {
      if (!event.eventType.startsWith('probe.')) return;
      // Найдём probe.id по dispatchedNotificationId.
      const probe = await this.prisma.probeEvent.findFirst({
        where: {
          tenantId: event.tenantId,
          dispatchedNotificationId: event.notificationId,
        },
      });
      if (!probe) return;
      const kind = await this.lookupDeliveryKind(event.notificationId);

      this.metrics.incProbeResponse({
        eventType: event.eventType,
        kind: kind ?? 'unknown',
      });
      if (probe.dispatchedAt) {
        const sec = (Date.now() - probe.dispatchedAt.getTime()) / 1000;
        this.metrics.observeProbeResponseTime({
          eventType: event.eventType,
          kind: kind ?? 'unknown',
          seconds: sec,
        });
      }

      // ── closing-loop: RawEvent + probe_closed_total ──────────────
      await this.ingestResponseAsRawEvent({
        tenantId: event.tenantId,
        userId: event.recipientUserId,
        notificationId: event.notificationId,
        eventType: event.eventType,
        payload: event.payload,
        sourceChannelKind: kind,
        contextBlockId: event.contextBlockId,
        contextCardId: event.contextCardId,
      });
      this.metrics.incProbeClosed({
        tenantTop: this.normalizeTenantTop(event.tenantId),
        source: kind ?? 'unknown',
      });

      this.logger.log(
        `probe.responded: probeId=${probe.id} eventType=${event.eventType} kind=${kind ?? 'unknown'} (closing-loop applied)`,
      );
    } catch (err) {
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }

  /**
   * Записывает ответ как `RawEvent` через ConversationalIngestAdapter.
   * Ошибки логируем, но не пробрасываем — основной flow ответа
   * (Notification.respondedAt) уже завершён, дублировать его не нужно.
   */
  private async ingestResponseAsRawEvent(args: {
    tenantId: string;
    userId: string;
    notificationId: string;
    eventType: string;
    payload: Record<string, unknown>;
    sourceChannelKind: string | null;
    contextBlockId: string | null;
    contextCardId: string | null;
  }): Promise<void> {
    try {
      await this.ingestAdapter.ingestNotificationResponse({
        tenantId: args.tenantId,
        userId: args.userId,
        notificationId: args.notificationId,
        eventType: args.eventType,
        payload: args.payload as Record<string, unknown>,
        sourceChannelKind: args.sourceChannelKind,
        contextBlockId: args.contextBlockId,
        contextCardId: args.contextCardId,
      });
    } catch (err) {
      this.logger.warn(
        {
          notificationId: args.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: ingestNotificationResponse упал — продолжаю',
      );
    }
  }

  /**
   * Нормализация tenant-id для метрики (контроль cardinality).
   * Сейчас используем первые 8 символов tenantId — этого достаточно, чтобы
   * различать ~top-100 тенантов. Полноценная top-100 нормализация — γ+.
   */
  private normalizeTenantTop(tenantId: string): string {
    if (!tenantId) return 'other';
    return tenantId.slice(0, 8);
  }

  /** Берём kind первого NotificationDelivery, у которого есть channel. */
  private async lookupDeliveryKind(
    notificationId: string,
  ): Promise<string | null> {
    const d = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId },
      include: { channelBinding: { include: { channel: true } } },
    });
    return d?.channelBinding?.channel?.kind ?? null;
  }
}
