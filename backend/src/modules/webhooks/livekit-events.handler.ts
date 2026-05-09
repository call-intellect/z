import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type WebhookEvent } from 'livekit-server-sdk';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { MeetingsService } from '../meetings/meetings.service';
import { RecordingsService } from '../recordings/recordings.service';

/**
 * Маршрутизация LiveKit-вебхуков по типу события.
 *
 *   room_started       → Meeting: scheduled → active, startedAt = now.
 *   room_finished      → Meeting: active → completed, endedAt = now,
 *                         + business-метрика finished{type}.
 *   participant_joined → upsert Participant.joinedAt; на отсутствие — создаём
 *                         guest Participant'а (отказоустойчивость).
 *   participant_left   → Participant.leftAt = now (статус meeting не трогаем).
 *   track_published (audio) → Recordings.ensureTrackEgress (если запись активна).
 *   track_unpublished  → no-op (MeetingEvent уже пишет LivekitWebhooksService).
 *   egress_started     → Recording.status: requested → recording (composite)
 *                          либо AudioTrack.startedAt (track).
 *   egress_ended       → mainVideoUrl/bytes/duration (composite) или AudioTrack
 *                          (track). Если всё готово — Meeting → recording_ready.
 *   egress_updated     → no-op (статус-апдейты не нужны для FSM).
 *   egress_failed      → Recording.status = 'failed', при необходимости
 *                          Meeting → failed.
 *
 * Все мутации статуса встречи — через `MeetingsService.transitionStatus`,
 * который сам проверяет FSM и пишет `MeetingEvent`.
 */
@Injectable()
export class LivekitEventsHandler {
  private readonly logger = new Logger(LivekitEventsHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    /**
     * `RecordingsService` — `forwardRef` для подстраховки от циклов
     * (Recordings ←→ Webhooks, если в будущем расширим).
     * Также может быть `null` в юнит-тестах (LivekitEventsHandler без
     * recordings-зависимости — уже существующие тесты Фазы 3.3).
     */
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService | null = null,
    /**
     * `AiQueueService` — глобальный (`AiModule`). В юнит-тестах Фазы 3 его нет,
     * поэтому делаем `@Optional()`: дефолтное `null`, проверка перед вызовом.
     */
    @Optional()
    @Inject(AiQueueService)
    private readonly aiQueue: AiQueueService | null = null,
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
        if (meetingId) await this.onTrackPublished(meetingId, event);
        return;
      case 'track_unpublished':
        // MeetingEvent уже пишется в LivekitWebhooksService — здесь no-op.
        return;
      case 'egress_started':
        if (meetingId) await this.onEgressStarted(meetingId, event);
        return;
      case 'egress_ended':
        if (meetingId) await this.onEgressEnded(meetingId, event);
        return;
      case 'egress_updated':
        return;
      // 'egress_failed' — нет в WebhookEventNames v2 как литерала, но LiveKit
      // присылает строку именно так в payload. Сохраняем для совместимости.
      case 'egress_failed' as never:
        if (meetingId) await this.onEgressFailed(meetingId, event);
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

  // ─────────────────────────── track_published ───────────────────────────

  private async onTrackPublished(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const track = this.extractTrack(event);
    if (!track || track.kind !== 'audio') {
      this.logger.debug(
        { meetingId, kind: track?.kind },
        'track_published: не audio или нет track — no-op',
      );
      return;
    }
    const participant = this.extractParticipant(event);
    if (!participant?.identity) {
      this.logger.warn({ meetingId, trackId: track.sid }, 'track_published: нет participant');
      return;
    }
    await this.recordings.ensureTrackEgress(
      { id: meetingId },
      participant,
      { sid: track.sid },
    );
  }

  // ─────────────────────────── egress_started ────────────────────────────

  private async onEgressStarted(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const info = this.extractEgressInfo(event);
    if (!info) return;

    if (info.requestType === 'room_composite' || info.requestType === 'roomComposite') {
      await this.recordings.markCompositeStarted(meetingId, info.egressId);
      this.logger.log({ meetingId, egressId: info.egressId }, 'egress_started: composite');
      return;
    }
    if (info.requestType === 'track') {
      // Старт track egress'а — отметим время в AudioTrack'е (если найдём по trackEgressId).
      await this.prisma.audioTrack.updateMany({
        where: { trackEgressId: info.egressId },
        data: { startedAt: new Date() },
      });
      this.logger.log({ meetingId, egressId: info.egressId }, 'egress_started: track');
    }
  }

  // ─────────────────────────── egress_ended ──────────────────────────────

  private async onEgressEnded(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const info = this.extractEgressInfo(event);
    if (!info) return;

    if (info.requestType === 'room_composite' || info.requestType === 'roomComposite') {
      const file = info.fileResults[0] ?? null;
      const result = await this.recordings.onCompositeEnded(meetingId, {
        url: file?.location ?? null,
        bytes: file?.size ?? null,
        durationSeconds:
          file?.duration !== null && file?.duration !== undefined
            ? Math.round(file.duration / 1_000_000_000) // ns → s
            : null,
      });
      await this.maybePromoteMeetingToReady(meetingId, result.allReady);
      return;
    }

    if (info.requestType === 'track') {
      const file = info.fileResults[0] ?? null;
      const result = await this.recordings.onTrackEnded(meetingId, info.egressId, {
        url: file?.location ?? null,
        bytes: file?.size ?? null,
        durationSeconds:
          file?.duration !== null && file?.duration !== undefined
            ? Math.round(file.duration / 1_000_000_000)
            : null,
        endedAt: new Date(),
      });
      await this.maybePromoteMeetingToReady(meetingId, result.allReady);
    }
  }

  // ─────────────────────────── egress_failed ─────────────────────────────

  private async onEgressFailed(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const info = this.extractEgressInfo(event);
    const reason = info?.error || 'egress_failed';
    await this.recordings.markFailed(meetingId, reason);

    // Если запись фатально упала — переводим встречу в failed (если ещё не там).
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (
      meeting &&
      meeting.status !== 'failed' &&
      meeting.status !== 'ai_ready'
    ) {
      try {
        await this.meetings.transitionStatus(meetingId, 'failed', {
          failureReason: 'recording_failed',
          reason: 'livekit:egress_failed',
        });
      } catch (err) {
        // FSM может отказать (уже terminal) — это норма, логируем.
        this.logger.debug(
          { meetingId, err: err instanceof Error ? err.message : String(err) },
          'egress_failed: переход в failed не выполнен',
        );
      }
    }
  }

  /**
   * После egress_ended: если recording.status стал `ready` — переводим встречу
   * `completed → recording_processing → recording_ready`. Делаем оба перехода
   * одним вызовом, потому что FSM их связывает.
   */
  private async maybePromoteMeetingToReady(
    meetingId: string,
    allReady: boolean,
  ): Promise<void> {
    if (!allReady) return;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { status: true },
    });
    if (!meeting) return;

    try {
      // completed → recording_processing → recording_ready (если ещё в completed).
      if (meeting.status === 'completed') {
        await this.meetings.transitionStatus(meetingId, 'recording_processing', {
          reason: 'livekit:egress_ended',
        });
      }
      const cur = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { status: true },
      });
      if (cur?.status === 'recording_processing') {
        await this.meetings.transitionStatus(meetingId, 'recording_ready', {
          reason: 'livekit:egress_ended',
        });
      }

      // Фаза 5: ставим BullMQ job на транскрибацию.
      if (this.aiQueue) {
        try {
          await this.aiQueue.enqueueTranscribe(meetingId);
          this.logger.log(
            { meetingId },
            'recording_ready: AI-pipeline (transcribe) поставлен в очередь',
          );
        } catch (qerr) {
          this.logger.warn(
            { meetingId, err: qerr instanceof Error ? qerr.message : String(qerr) },
            'recording_ready: enqueueTranscribe не удался',
          );
        }
      } else {
        this.logger.warn(
          { meetingId },
          'recording_ready: AiQueueService недоступен (нет AiModule в контексте)',
        );
      }
    } catch (err) {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'maybePromoteMeetingToReady: FSM-переход не удался',
      );
    }
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

  /**
   * Извлекает audio/video kind из payload'а. LiveKit может прислать `track.type`
   * как enum (`AUDIO`/`VIDEO`/`DATA`) либо строку — нормализуем к 'audio' |
   * 'video' | 'data' | null.
   */
  private extractTrack(event: WebhookEvent): { sid: string; kind: string } | null {
    const t = (event as unknown as {
      track?: { sid?: unknown; type?: unknown; kind?: unknown };
    }).track;
    if (!t) return null;
    const sid = typeof t.sid === 'string' ? t.sid : '';
    if (!sid) return null;

    // Нормализация kind: TrackType enum или строка.
    let kind = '';
    if (typeof t.kind === 'string') {
      kind = t.kind.toLowerCase();
    } else if (typeof t.type === 'string') {
      kind = t.type.toLowerCase();
    } else if (typeof t.type === 'number') {
      // proto3: 0 = AUDIO, 1 = VIDEO, 2 = DATA.
      kind = t.type === 0 ? 'audio' : t.type === 1 ? 'video' : t.type === 2 ? 'data' : '';
    }
    return { sid, kind };
  }

  /**
   * Достаёт `egressInfo` из webhook'а, нормализуя к простому DTO.
   * `requestType` — что именно: composite/track. У SDK это `request.case`
   * (`'roomComposite'` | `'track'` | ...).
   */
  private extractEgressInfo(
    event: WebhookEvent,
  ): {
    egressId: string;
    requestType: string;
    fileResults: Array<{
      filename: string | null;
      location: string | null;
      size: number | null;
      duration: number | null;
    }>;
    error: string | null;
  } | null {
    const info = (event as unknown as {
      egressInfo?: {
        egressId?: unknown;
        request?: { case?: unknown };
        // На webhook'ах LiveKit часто приходит уже сериализованным JSON'ом —
        // тогда поле `request` ожидаемо отсутствует, а есть `request_type` /
        // `requestType` или поля в самом info. Парсим максимально лояльно.
        requestType?: unknown;
        request_type?: unknown;
        roomComposite?: unknown;
        room_composite?: unknown;
        track?: unknown;
        fileResults?: unknown;
        file_results?: unknown;
        error?: unknown;
      };
      egress_info?: unknown; // snake_case вариант
    }).egressInfo ?? (event as unknown as { egress_info?: unknown }).egress_info;
    if (!info || typeof info !== 'object') return null;

    const obj = info as Record<string, unknown>;
    const egressId = String(obj.egressId ?? obj.egress_id ?? '');
    if (!egressId) return null;

    // Тип запроса — несколько возможных мест.
    let requestType = '';
    const req = obj.request as { case?: unknown } | undefined;
    if (req && typeof req.case === 'string') {
      requestType = req.case;
    } else if (typeof obj.requestType === 'string') {
      requestType = obj.requestType;
    } else if (typeof obj.request_type === 'string') {
      requestType = obj.request_type;
    } else if (obj.roomComposite || obj.room_composite) {
      requestType = 'roomComposite';
    } else if (obj.track) {
      requestType = 'track';
    }

    const fileResultsRaw =
      (obj.fileResults as unknown[] | undefined) ??
      (obj.file_results as unknown[] | undefined) ??
      [];
    const fileResults = fileResultsRaw.map((f) => {
      const fo = (f ?? {}) as Record<string, unknown>;
      const sizeRaw = fo.size;
      const durationRaw = fo.duration;
      return {
        filename:
          typeof fo.filename === 'string' ? fo.filename : null,
        location: typeof fo.location === 'string' ? fo.location : null,
        size:
          typeof sizeRaw === 'number'
            ? sizeRaw
            : typeof sizeRaw === 'string' && sizeRaw !== ''
              ? Number(sizeRaw)
              : typeof sizeRaw === 'bigint'
                ? Number(sizeRaw)
                : null,
        duration:
          typeof durationRaw === 'number'
            ? durationRaw
            : typeof durationRaw === 'string' && durationRaw !== ''
              ? Number(durationRaw)
              : typeof durationRaw === 'bigint'
                ? Number(durationRaw)
                : null,
      };
    });

    const error = typeof obj.error === 'string' ? obj.error : null;

    return { egressId, requestType, fileResults, error };
  }
}
