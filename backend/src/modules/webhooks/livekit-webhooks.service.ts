import { Inject, Injectable, Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Prisma } from '@prisma/client';
import { type WebhookEvent } from 'livekit-server-sdk';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LivekitEventsHandler } from './livekit-events.handler';
import { LivekitSignatureVerifier } from './livekit-signature.verifier';

/**
 * Counter `livekit_webhook_events_total{type, dedup}` — фиксирует все принятые
 * события и помечает дубликаты.
 */
export const LIVEKIT_WEBHOOK_EVENTS_TOTAL = 'livekit_webhook_events_total';

/**
 * Сервис обработки LiveKit-вебхуков.
 *
 * Алгоритм:
 *   1. Верифицировать подпись (`LivekitSignatureVerifier`).
 *   2. Дедуп: попытка `webhookSeenEvent.create` с уникальным PK = event.id.
 *      На P2002 (Unique violation) — это дубль, инкремент `dedup=true` метрики, return.
 *   3. На свежем событии — инкремент `dedup=false` метрики и (если в payload
 *      есть `room.name` и встреча есть в БД) запись в `meeting_event`.
 *      Полная маршрутизация в FSM — Фазы 3.3 и 4.2.
 */
@Injectable()
export class LivekitWebhooksService {
  private readonly logger = new Logger(LivekitWebhooksService.name);

  constructor(
    @Inject(LivekitSignatureVerifier)
    private readonly verifier: LivekitSignatureVerifier,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectMetric(LIVEKIT_WEBHOOK_EVENTS_TOTAL)
    private readonly eventsTotal: Counter<'type' | 'dedup'>,
    @Inject(LivekitEventsHandler)
    private readonly eventsHandler: LivekitEventsHandler,
  ) {}

  async handle(rawBody: Buffer, authHeader: string | undefined): Promise<void> {
    const event = this.verifier.verify({ rawBody, authHeader });

    const eventId = this.extractEventId(event);
    const eventType = event.event ?? 'unknown';

    if (!eventId) {
      // Без id невозможно дедуплицировать — лог и игнор (LiveKit всегда шлёт id).
      this.logger.warn({ eventType }, 'LiveKit webhook без event.id — пропускаем');
      this.eventsTotal.inc({ type: eventType, dedup: 'false' });
      return;
    }

    // Дедуп.
    try {
      await this.prisma.webhookSeenEvent.create({
        data: { eventId, eventType },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.eventsTotal.inc({ type: eventType, dedup: 'true' });
        this.logger.debug({ eventId, eventType }, 'LiveKit webhook: дубликат');
        return;
      }
      throw err;
    }

    // Свежее событие.
    this.eventsTotal.inc({ type: eventType, dedup: 'false' });
    this.logger.log({ eventId, eventType }, 'LiveKit webhook принят');

    // Минимальная маршрутизация (Фаза 1.7): MeetingEvent если встреча есть.
    const meetingId = this.extractMeetingId(event);
    if (meetingId) {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { id: true },
      });
      if (meeting) {
        await this.prisma.meetingEvent.create({
          data: {
            meetingId,
            eventType,
            payload: this.toJson(event),
          },
        });
      }
    }

    // Фаза 3.3: маршрутизация в FSM-переходы и upsert participant'ов.
    // Хэндлер сам решает, надо ли что-то делать по типу события.
    try {
      await this.eventsHandler.handle(event);
    } catch (err) {
      // Логируем, но не валим обработку — webhook уже дедуплицирован.
      // LiveKit не будет ретраить (мы вернули 200).
      this.logger.error(
        { err, eventType, eventId },
        'LivekitEventsHandler упал — событие уже зафиксировано в meeting_event',
      );
    }
  }

  private extractEventId(event: WebhookEvent): string | null {
    const id = (event as unknown as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  private extractMeetingId(event: WebhookEvent): string | null {
    // У LiveKit room name = meetingId (в нашей конвенции из §2.2 ТЗ).
    const ev = event as unknown as {
      room?: { name?: unknown };
      egressInfo?: { roomName?: unknown };
    };
    const fromRoom = ev.room?.name;
    if (typeof fromRoom === 'string' && fromRoom.length > 0) return fromRoom;
    // Egress webhooks don't include `room` — fall back to egressInfo.roomName.
    const fromEgress = ev.egressInfo?.roomName;
    if (typeof fromEgress === 'string' && fromEgress.length > 0) return fromEgress;
    return null;
  }

  private toJson(event: WebhookEvent): Prisma.InputJsonValue {
    // WebhookEvent — это plain object от LiveKit SDK; безопасно сериализовать.
    return JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
  }
}
