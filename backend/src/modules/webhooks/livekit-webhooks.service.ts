import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { type WebhookEvent } from 'livekit-server-sdk';
import { Counter } from 'prom-client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

import { LivekitEventsHandler } from './livekit-events.handler';
import { LivekitSignatureVerifier } from './livekit-signature.verifier';

export const LIVEKIT_WEBHOOK_EVENTS_TOTAL = 'livekit_webhook_events_total';

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
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async handle(rawBody: Buffer, authHeader: string | undefined): Promise<void> {
    const event = this.verifier.verify({ rawBody, authHeader });

    const eventId = this.extractEventId(event);
    const eventType = event.event ?? 'unknown';

    if (!eventId) {
      this.logger.warn({ eventType }, 'LiveKit webhook без event.id — пропускаем');
      this.eventsTotal.inc({ type: eventType, dedup: 'false' });
      return;
    }

    try {
      await this.prisma.webhookSeenEvent.create({
        data: { eventId, eventType },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.eventsTotal.inc({ type: eventType, dedup: 'true' });
        this.logger.debug({ eventId, eventType }, 'LiveKit webhook: дубликат');
        return;
      }
      throw err;
    }

    this.eventsTotal.inc({ type: eventType, dedup: 'false' });
    this.logger.log({ eventId, eventType }, 'LiveKit webhook принят');

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

    if (this.cfg.livekit.webhookAckFirstEnabled) {
      void this.eventsHandler.handle(event).catch((err) => {
        this.logger.error(
          { err, eventType, eventId },
          'LivekitEventsHandler упал (ack-first фон) — событие зафиксировано в meeting_event',
        );
      });
    } else {
      try {
        await this.eventsHandler.handle(event);
      } catch (err) {
        this.logger.error(
          { err, eventType, eventId },
          'LivekitEventsHandler упал — событие уже зафиксировано в meeting_event',
        );
      }
    }
  }

  private extractEventId(event: WebhookEvent): string | null {
    const id = (event as unknown as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  private extractMeetingId(event: WebhookEvent): string | null {
    const ev = event as unknown as {
      room?: { name?: unknown };
      egressInfo?: { roomName?: unknown };
    };
    const fromRoom = ev.room?.name;
    if (typeof fromRoom === 'string' && fromRoom.length > 0) return fromRoom;
    const fromEgress = ev.egressInfo?.roomName;
    if (typeof fromEgress === 'string' && fromEgress.length > 0) return fromEgress;
    return null;
  }

  private toJson(event: WebhookEvent): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
  }
}
