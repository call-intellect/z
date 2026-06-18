import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type WebhookEvent } from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { PipelineRunner, SystemLogPipeline, traceForMeeting } from '../logging/log-pipeline';
import { MeetingsService } from '../meetings/meetings.service';
import { RecordingsService } from '../recordings/recordings.service';

import { MeetingFinalizationService } from './meeting-finalization.service';

const KIND_BY_NUMBER: Record<number, string> = {
  0: 'STANDARD',
  1: 'INGRESS',
  2: 'EGRESS',
  3: 'SIP',
  4: 'AGENT',
  7: 'CONNECTOR',
  8: 'BRIDGE',
};

@Injectable()
export class LivekitEventsHandler {
  private readonly logger = new Logger(LivekitEventsHandler.name);

  @Optional()
  @Inject(PipelineRunner)
  private readonly pipe: PipelineRunner | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService | null = null,
    @Optional()
    @Inject(AiQueueService)
    private readonly aiQueue: AiQueueService | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
    @Inject(MeetingFinalizationService)
    private readonly finalization: MeetingFinalizationService,
  ) {}

  async handle(event: WebhookEvent): Promise<void> {
    const eventType = event.event ?? '';
    const meetingId = this.extractMeetingId(event);

    this.metrics.incLivekitWebhookEvent(eventType);

    const run = (): Promise<void> => this.route(eventType, meetingId, event);
    if (this.pipe && meetingId) {
      const pipeline = eventType.startsWith('egress')
        ? SystemLogPipeline.RECORDING
        : SystemLogPipeline.MEETING_LIFECYCLE;
      return this.pipe.with(
        { pipeline, traceId: traceForMeeting(meetingId), module: 'livekit.webhook' },
        run,
      );
    }
    return run();
  }

  private async route(
    eventType: string,
    meetingId: string | null,
    event: WebhookEvent,
  ): Promise<void> {
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
        return;
      case 'egress_started':
        if (meetingId) await this.onEgressStarted(meetingId, event);
        return;
      case 'egress_ended':
        if (meetingId) await this.onEgressEnded(meetingId, event);
        return;
      case 'egress_updated':
        return;
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

  private async onRoomStarted(meetingId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'room_started: встреча не найдена');
      return;
    }
    if (meeting.status === 'active') {
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

    if (meeting.recordByDefault && this.recordings) {
      try {
        await this.recordings.start(meetingId, meeting.ownerId);
        this.logger.log({ meetingId }, 'room_started: auto-recording started (recordByDefault)');
      } catch (err) {
        this.logger.warn(
          { meetingId, err: err instanceof Error ? err.message : String(err) },
          'room_started: auto-recording start failed (non-fatal)',
        );
      }
    }
  }

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

  private async onParticipantJoined(meetingId: string, event: WebhookEvent): Promise<void> {
    const participantInfo = this.extractParticipant(event);
    if (!participantInfo?.identity) return;

    const kind = this.extractParticipantKind(event);
    if (kind !== null) {
      if (kind !== 'STANDARD') {
        this.logger.debug(
          { meetingId, identity: participantInfo.identity, kind },
          'participant_joined: сервисный участник (kind != STANDARD) — no-op',
        );
        return;
      }
    } else {
      if (
        !participantInfo.identity.startsWith('host:') &&
        !participantInfo.identity.startsWith('guest:') &&
        !participantInfo.identity.startsWith('invitee:')
      ) {
        this.logger.debug(
          { meetingId, identity: participantInfo.identity },
          'participant_joined: identity не host/guest и нет kind (egress-рекордер?) — no-op',
        );
        return;
      }
    }

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

    const role: 'host' | 'guest' = participantInfo.identity.startsWith('host:') ? 'host' : 'guest';
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return;
      }
      throw err;
    }
  }

  private async onParticipantLeft(meetingId: string, event: WebhookEvent): Promise<void> {
    const participantInfo = this.extractParticipant(event);
    if (!participantInfo?.identity) return;

    await this.prisma.participant.updateMany({
      where: { meetingId, livekitIdentity: participantInfo.identity },
      data: { leftAt: new Date() },
    });
  }

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
    await this.recordings.ensureTrackEgress({ id: meetingId }, participant, { sid: track.sid });
  }

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
      await this.prisma.audioTrack.updateMany({
        where: { trackEgressId: info.egressId },
        data: { startedAt: info.startedAt ?? new Date() },
      });
      this.logger.log(
        { meetingId, egressId: info.egressId, startedAt: info.startedAt?.toISOString() ?? null },
        'egress_started: track',
      );
    }
  }

  private async onEgressEnded(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const info = this.extractEgressInfo(event);
    if (!info) return;

    try {
      const m = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { endedAt: true },
      });
      if (m?.endedAt) {
        this.metrics.observeEgressEndedGap(
          info.requestType,
          (Date.now() - m.endedAt.getTime()) / 1000,
        );
      }
    } catch {}

    if (info.requestType === 'room_composite' || info.requestType === 'roomComposite') {
      const file = info.fileResults[0] ?? null;
      const result = await this.recordings.onCompositeEnded(meetingId, {
        url: file?.location ?? null,
        bytes: file?.size ?? null,
        durationSeconds:
          file?.duration !== null && file?.duration !== undefined
            ? Math.round(file.duration / 1_000_000_000)
            : null,
      });
      await this.finalization.enqueueFaststartIfNeeded(meetingId, file?.size ?? null);
      await this.finalization.promoteMeetingToReady(meetingId, result.allReady);
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
      await this.finalization.promoteMeetingToReady(meetingId, result.allReady);
    }
  }

  private async onEgressFailed(meetingId: string, event: WebhookEvent): Promise<void> {
    if (!this.recordings) return;
    const info = this.extractEgressInfo(event);
    const reason = info?.error || 'egress_failed';
    await this.recordings.markFailed(meetingId, reason);

    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (meeting && meeting.status !== 'failed' && meeting.status !== 'ai_ready') {
      try {
        await this.meetings.transitionStatus(meetingId, 'failed', {
          failureReason: 'recording_failed',
          reason: 'livekit:egress_failed',
        });
      } catch (err) {
        this.logger.debug(
          { meetingId, err: err instanceof Error ? err.message : String(err) },
          'egress_failed: переход в failed не выполнен',
        );
      }
    }
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

  private extractParticipant(event: WebhookEvent): { identity: string; name: string } | null {
    const p = (event as unknown as { participant?: { identity?: unknown; name?: unknown } })
      .participant;
    if (!p) return null;
    const identity = typeof p.identity === 'string' ? p.identity : '';
    const name = typeof p.name === 'string' ? p.name : '';
    if (!identity) return null;
    return { identity, name };
  }

  private extractParticipantKind(event: WebhookEvent): string | null {
    const p = (event as unknown as { participant?: { kind?: unknown } }).participant;
    if (!p) return null;
    const k = p.kind;
    if (typeof k === 'number') return KIND_BY_NUMBER[k] ?? null;
    if (typeof k === 'string') {
      const up = k.trim().toUpperCase();
      if (up === '') return null;
      if (/^\d+$/.test(up)) return KIND_BY_NUMBER[Number(up)] ?? null;
      return up;
    }
    return null;
  }

  private extractTrack(event: WebhookEvent): { sid: string; kind: string } | null {
    const t = (
      event as unknown as {
        track?: { sid?: unknown; type?: unknown; kind?: unknown };
      }
    ).track;
    if (!t) return null;
    const sid = typeof t.sid === 'string' ? t.sid : '';
    if (!sid) return null;

    let kind = '';
    if (typeof t.kind === 'string') {
      kind = t.kind.toLowerCase();
    } else if (typeof t.type === 'string') {
      kind = t.type.toLowerCase();
    } else if (typeof t.type === 'number') {
      kind = t.type === 0 ? 'audio' : t.type === 1 ? 'video' : t.type === 2 ? 'data' : '';
    }
    if (!kind) kind = 'audio';
    return { sid, kind };
  }

  static parseEgressStartedAt(startedAtNs: unknown, createdAtSec?: unknown): Date | null {
    const fromNs = (raw: unknown): Date | null => {
      let n: number | null = null;
      if (typeof raw === 'bigint') n = Number(raw);
      else if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && raw !== '') {
        const parsed = Number(raw);
        n = Number.isFinite(parsed) ? parsed : null;
      }
      if (n === null || !Number.isFinite(n) || n <= 0) return null;
      const ms = n / 1_000_000;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const fromSec = (raw: unknown): Date | null => {
      let n: number | null = null;
      if (typeof raw === 'bigint') n = Number(raw);
      else if (typeof raw === 'number') n = raw;
      else if (typeof raw === 'string' && raw !== '') {
        const parsed = Number(raw);
        n = Number.isFinite(parsed) ? parsed : null;
      }
      if (n === null || !Number.isFinite(n) || n <= 0) return null;
      const d = new Date(n * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    return fromNs(startedAtNs) ?? fromSec(createdAtSec);
  }

  private extractEgressInfo(event: WebhookEvent): {
    egressId: string;
    requestType: string;
    fileResults: Array<{
      filename: string | null;
      location: string | null;
      size: number | null;
      duration: number | null;
    }>;
    startedAt: Date | null;
    error: string | null;
  } | null {
    const info =
      (
        event as unknown as {
          egressInfo?: {
            egressId?: unknown;
            request?: { case?: unknown };
            requestType?: unknown;
            request_type?: unknown;
            roomComposite?: unknown;
            room_composite?: unknown;
            track?: unknown;
            fileResults?: unknown;
            file_results?: unknown;
            startedAt?: unknown;
            started_at?: unknown;
            error?: unknown;
          };
          egress_info?: unknown;
        }
      ).egressInfo ?? (event as unknown as { egress_info?: unknown }).egress_info;
    if (!info || typeof info !== 'object') return null;

    const obj = info as Record<string, unknown>;
    const egressId = String(obj.egressId ?? obj.egress_id ?? '');
    if (!egressId) return null;

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
        filename: typeof fo.filename === 'string' ? fo.filename : null,
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

    const createdAtSec =
      (event as unknown as { createdAt?: unknown }).createdAt ??
      (event as unknown as { created_at?: unknown }).created_at;
    const startedAt = LivekitEventsHandler.parseEgressStartedAt(
      obj.startedAt ?? obj.started_at,
      createdAtSec,
    );

    return { egressId, requestType, fileResults, startedAt, error };
  }
}
