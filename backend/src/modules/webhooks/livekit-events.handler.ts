import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type WebhookEvent } from 'livekit-server-sdk';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MeetingsService } from '../meetings/meetings.service';

/**
 * Маршрутизация LiveKit-вебхуков по типу события.
 *
 *   room_started       → Meeting: scheduled → active, startedAt = now.
 *   room_finished      → Meeting: active → completed, endedAt = now,
 *                         + business-метрика finished{type}.
 *   participant_joined → upsert Participant.joinedAt; на отсутствие — создаём
 *                         guest Participant'а (отказоустойчивость).
 *   participant_left   → Participant.leftAt = now (статус meeting не трогаем).
 *   track_published / track_unpublished → MeetingEvent (детали — Фаза 4).
 *   egress_*           → no-op (Фаза 4.2).
 *
 * Все мутации статуса встречи — через `MeetingsService.transitionStatus`,
 * который сам проверяет FSM и пишет `MeetingEvent`.
 *
 * `MeetingEvent` для остальных событий пишет `LivekitWebhooksService` —
 * чтобы избежать двойной записи, хэндлер сам ничего лишнего не дублирует.
 */
@Injectable()
export class LivekitEventsHandler {
  private readonly logger = new Logger(LivekitEventsHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(event: WebhookEvent): Promise<void> {
    const eventType = event.event ?? '';
    const meetingId = this.extractMeetingId(event);

    // Бизнес-метрика — для всех событий, даже если meetingId не нашёлся.
    this.metrics.incLivekitWebhookEvent(eventType);

    switch (eventType) {
      case 'room_started':
        if (meetingId) await this.onRoomStarted(meetingId);
        return;
      case 'room_finished':
        if (meetingId) await this.onRoomFinished(meetingId);
        return;
      case 'participant_joined':
        if (meetingId) await this.onParticipantJoined(meetingId, event);
        return;
      case 'participant_left':
        if (meetingId) await this.onParticipantLeft(meetingId, event);
        return;
      case 'track_published':
      case 'track_unpublished':
        // MeetingEvent уже пишется в LivekitWebhooksService — здесь no-op.
        return;
      case 'egress_started':
      case 'egress_updated':
      case 'egress_ended':
      // 'egress_failed' — нет в WebhookEventNames v2, но сохраним для совместимости.
      case 'egress_failed' as never:
        // Фаза 4.2.
        return;
      default:
        this.logger.debug(
          { eventType, meetingId },
          'LivekitEventsHandler: тип события не маршрутизирован',
        );
        return;
    }
  }

  // ─────────────────────────── room_started ──────────────────────────────

  private async onRoomStarted(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'room_started: встреча не найдена');
      return;
    }
    if (meeting.status === 'active') {
      // Идемпотентно: дубль room_started — норма (LiveKit может прислать ретраем).
      this.logger.debug({ meetingId }, 'room_started: уже active, no-op');
      return;
    }
    if (meeting.status !== 'scheduled') {
      this.logger.warn(
        { meetingId, status: meeting.status },
        'room_started: статус не scheduled — игнорируем',
      );
      return;
    }
    await this.meetings.transitionStatus(meetingId, 'active', {
      startedAt: new Date(),
      reason: 'livekit:room_started',
    });
    this.logger.log({ meetingId }, 'room_started → meeting.active');
  }

  // ─────────────────────────── room_finished ─────────────────────────────

  private async onRoomFinished(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'room_finished: встреча не найдена');
      return;
    }
    if (meeting.status !== 'active') {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'room_finished: статус не active, no-op',
      );
      return;
    }
    await this.meetings.transitionStatus(meetingId, 'completed', {
      endedAt: new Date(),
      reason: 'livekit:room_finished',
    });
    this.metrics.incMeetingFinished(meeting.type);
    this.logger.log({ meetingId }, 'room_finished → meeting.completed');
  }

  // ─────────────────────────── participant_joined ────────────────────────

  private async onParticipantJoined(
    meetingId: string,
    event: WebhookEvent,
  ): Promise<void> {
    const participantInfo = this.extractParticipant(event);
    if (!participantInfo?.identity) return;

    const existing = await this.prisma.participant.findUnique({
      where: {
        meetingId_livekitIdentity: {
          meetingId,
          livekitIdentity: participantInfo.identity,
        },
      },
    });

    if (existing) {
      await this.prisma.participant.update({
        where: { id: existing.id },
        data: { joinedAt: new Date() },
      });
      return;
    }

    // Отказоустойчивость: участник в room без Participant записи в БД.
    // Теоретически невозможно (без токена не зайдёшь), но фиксируем фактический мир.
    const role: 'host' | 'guest' = participantInfo.identity.startsWith('host:')
      ? 'host'
      : 'guest';
    try {
      await this.prisma.participant.create({
        data: {
          meetingId,
          livekitIdentity: participantInfo.identity,
          name: participantInfo.name || 'Participant',
          role,
          isRegisteredUser: false,
          joinedAt: new Date(),
        },
      });
    } catch (err) {
      // На race с join'ом — игнор, апдейтнем joinedAt в следующий раз.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  // ─────────────────────────── participant_left ──────────────────────────

  private async onParticipantLeft(
    meetingId: string,
    event: WebhookEvent,
  ): Promise<void> {
    const participantInfo = this.extractParticipant(event);
    if (!participantInfo?.identity) return;

    await this.prisma.participant.updateMany({
      where: { meetingId, livekitIdentity: participantInfo.identity },
      data: { leftAt: new Date() },
    });
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  private extractMeetingId(event: WebhookEvent): string | null {
    const room = (event as unknown as { room?: { name?: unknown } }).room;
    const name = room?.name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  }

  private extractParticipant(
    event: WebhookEvent,
  ): { identity: string; name: string } | null {
    const p = (event as unknown as { participant?: { identity?: unknown; name?: unknown } })
      .participant;
    if (!p) return null;
    const identity = typeof p.identity === 'string' ? p.identity : '';
    const name = typeof p.name === 'string' ? p.name : '';
    if (!identity) return null;
    return { identity, name };
  }
}
