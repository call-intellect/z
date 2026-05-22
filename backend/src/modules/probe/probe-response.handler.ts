import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
 * Полный flow "ответ → новый RawEvent → ingest pipeline" в β-5 не делаем
 * (нужен conversational Source с type='conversational' — TODO γ+).
 * Сейчас метрика откликов и связка ProbeEvent↔Notification.respondedAt —
 * этого достаточно для замыкания петли в админ-нотификациях.
 */
@Injectable()
export class ProbeResponseHandler {
  private readonly logger = new Logger(ProbeResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
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
      this.logger.log(
        `probe.responded: probeId=${probe.id} eventType=${event.eventType} kind=${kind ?? 'unknown'}`,
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
