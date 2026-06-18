import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Recording, type RecordingStatus } from '@prisma/client';
import { TrackType } from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';
import {
  MeetingNotFoundError,
  NotAuthorizedError,
  RecordingAlreadyDeletedError,
  RecordingInvalidStateError,
  RecordingNotFoundError,
  RecordingNotReadyError,
} from '../../common/errors/domain-errors';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LivekitService } from '../livekit/livekit.service';
import { MeetingVisibilityService } from '../meetings/meeting-visibility.service';
import { MeetingsService } from '../meetings/meetings.service';

import { LivekitEgressClient } from './livekit-egress.client';
import {
  audioTrackKey,
  compositeKey,
  extractKeyFromUrl,
} from './s3-keys';
import { S3Service } from './s3.service';

const PARTICIPANT_KIND_STANDARD = 0;

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  private readonly inflightTrackEgress = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitEgressClient) private readonly egress: LivekitEgressClient,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(MeetingVisibilityService) private readonly visibility: MeetingVisibilityService,
  ) {
    void this.meetings;
  }


  async start(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    if (meeting.status !== 'active') {
      throw new RecordingInvalidStateError(meetingId, meeting.status, 'meeting_active');
    }

    const existing = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (existing && existing.status !== 'not_started' && existing.status !== 'failed') {
      throw new RecordingInvalidStateError(meetingId, existing.status, 'not_started');
    }

    const retentionDays = this.cfg.retention.defaultDays;
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    const compositeOutputKey = compositeKey(meetingId);

    this.logger.debug(
      { meetingId, compositeOutputKey, bucket: this.cfg.s3.bucket, retentionDays },
      'Recording start: запускаем composite egress',
    );

    const egressResult = await this.egress.startRoomCompositeEgress(
      { id: meetingId },
      { bucket: this.cfg.s3.bucket, key: compositeOutputKey },
    );
    this.logger.debug(
      { meetingId, egressId: egressResult.egressId, compositeOutputKey },
      'Recording start: composite egress запущен',
    );

    await this.prisma.$transaction(async (tx) => {
      const recording = await tx.recording.upsert({
        where: { meetingId },
        update: {
          status: 'requested',
          retentionDays,
          expiresAt,
          compositeEgressId: egressResult.egressId,
          deletedAt: null,
          archivedAt: null,
        },
        create: {
          meetingId,
          status: 'requested',
          retentionDays,
          expiresAt,
          compositeEgressId: egressResult.egressId,
        },
      });

      await tx.recordingAction.create({
        data: {
          recordingId: recording.id,
          action: 'created',
          actor: `user:${userId}`,
          reason: 'host_request',
        },
      });
    });

    this.logger.log(
      { meetingId, egressId: egressResult.egressId, retentionDays },
      'Recording start',
    );

    await this.reconcileTrackEgress(meetingId).catch((err) => {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'Recording start: догон track egress не удался (добьёт сверка-cron)',
      );
    });
  }

  async stop(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      include: { audioTracks: true },
    });
    if (!recording) throw new RecordingNotFoundError(meetingId);
    if (recording.status !== 'recording' && recording.status !== 'requested') {
      throw new RecordingInvalidStateError(meetingId, recording.status, 'recording|requested');
    }

    if (recording.compositeEgressId) {
      try {
        await this.egress.stopEgress(recording.compositeEgressId);
      } catch (err) {
        this.logger.warn(
          {
            meetingId,
            egressId: recording.compositeEgressId,
            err: err instanceof Error ? err.message : String(err),
          },
          'stop: composite egress остановить не удалось',
        );
      }
    }
    for (const t of recording.audioTracks) {
      if (!t.trackEgressId) continue;
      try {
        await this.egress.stopEgress(t.trackEgressId);
      } catch (err) {
        this.logger.warn(
          {
            meetingId,
            egressId: t.trackEgressId,
            err: err instanceof Error ? err.message : String(err),
          },
          'stop: track egress остановить не удалось',
        );
      }
    }

    await this.prisma.recording.update({
      where: { meetingId },
      data: { status: 'finalizing' },
    });

    this.logger.log({ meetingId }, 'Recording stop запрошен → finalizing');
  }

  async ensureTrackEgress(
    meeting: { id: string },
    participant: { identity: string; name: string },
    track: { sid: string },
  ): Promise<void> {
    const recording = await this.prisma.recording.findUnique({
      where: { meetingId: meeting.id },
    });
    if (!recording) return;
    if (recording.status !== 'recording' && recording.status !== 'requested') {
      this.logger.debug(
        { meetingId: meeting.id, status: recording.status },
        'ensureTrackEgress: recording не активен, no-op',
      );
      return;
    }

    const lockKey = `${meeting.id}:${participant.identity}`;
    if (this.inflightTrackEgress.has(lockKey)) {
      this.logger.debug(
        { meetingId: meeting.id, identity: participant.identity },
        'ensureTrackEgress: трек уже в обработке (in-process lock), no-op',
      );
      return;
    }
    this.inflightTrackEgress.add(lockKey);
    try {
      await this.startTrackEgressLocked(meeting, participant, track, recording.id);
    } finally {
      this.inflightTrackEgress.delete(lockKey);
    }
  }

  private async startTrackEgressLocked(
    meeting: { id: string },
    participant: { identity: string; name: string },
    track: { sid: string },
    recordingId: string,
  ): Promise<void> {
    const existing = await this.prisma.audioTrack.findFirst({
      where: { recordingId, livekitIdentity: participant.identity },
    });
    if (existing) {
      this.logger.debug(
        { meetingId: meeting.id, identity: participant.identity },
        'ensureTrackEgress: AudioTrack уже создан, no-op',
      );
      return;
    }

    const participantRecord = await this.prisma.participant.findUnique({
      where: {
        meetingId_livekitIdentity: {
          meetingId: meeting.id,
          livekitIdentity: participant.identity,
        },
      },
      select: { id: true, name: true },
    });

    const trackKey = audioTrackKey(meeting.id, participant.identity);

    this.logger.debug(
      { meetingId: meeting.id, identity: participant.identity, trackSid: track.sid, trackKey },
      'ensureTrackEgress: запускаем track egress',
    );

    let egressId: string | null;
    try {
      const result = await this.egress.startTrackEgress(meeting, track.sid, {
        bucket: this.cfg.s3.bucket,
        key: trackKey,
      });
      egressId = result.egressId;
      this.logger.debug(
        { meetingId: meeting.id, identity: participant.identity, egressId, trackKey },
        'ensureTrackEgress: track egress запущен',
      );
    } catch (err) {
      this.logger.error(
        {
          meetingId: meeting.id,
          identity: participant.identity,
          trackId: track.sid,
          err: err instanceof Error ? err.message : String(err),
        },
        'ensureTrackEgress: не удалось запустить track egress',
      );
      this.metrics.incTrackEgressStartFailed({ reason: 'start_failed' });
      return;
    }

    const placeholderUrl = `s3://${this.cfg.s3.bucket}/${trackKey}`;
    try {
      await this.prisma.audioTrack.create({
        data: {
          recordingId,
          ...(participantRecord ? { participantId: participantRecord.id } : {}),
          participantName: participant.name || participantRecord?.name || 'Участник',
          livekitIdentity: participant.identity,
          trackId: track.sid,
          trackEgressId: egressId,
          audioUrl: placeholderUrl,
          startedAt: new Date(),
          endedAt: new Date(),
          durationSeconds: 0,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(
          { meetingId: meeting.id, identity: participant.identity },
          'ensureTrackEgress: race на создании AudioTrack — игнорируем',
        );
        return;
      }
      throw err;
    }
  }

  async reconcileTrackEgress(meetingId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
    });
    if (!recording) return;
    if (recording.status !== 'recording' && recording.status !== 'requested') {
      return;
    }

    let participants;
    try {
      participants = await this.livekit.listParticipants({ id: meetingId });
    } catch (err) {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'reconcileTrackEgress: listParticipants не удался — пропускаем тик',
      );
      return;
    }

    let added = 0;
    for (const p of participants) {
      if ((p.kind as number) !== PARTICIPANT_KIND_STANDARD) continue;
      if (!p.identity) continue;
      for (const tr of p.tracks ?? []) {
        if (tr.type !== TrackType.AUDIO) continue;
        if (!tr.sid) continue;
        try {
          await this.ensureTrackEgress(
            { id: meetingId },
            { identity: p.identity, name: p.name ?? '' },
            { sid: tr.sid },
          );
          added += 1;
        } catch (err) {
          this.logger.warn(
            {
              meetingId,
              identity: p.identity,
              trackSid: tr.sid,
              err: err instanceof Error ? err.message : String(err),
            },
            'reconcileTrackEgress: ensureTrackEgress упал для трека — добьёт следующий тик',
          );
        }
      }
    }

    if (added > 0) {
      this.logger.debug(
        { meetingId, audioTracksConsidered: added },
        'reconcileTrackEgress: сверка прошла',
      );
    }
  }

  async getDownloadUrl(
    meetingId: string,
    userId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    await this.visibility.assertCanView(meetingId, userId);
    return this.presignComposite(meetingId);
  }

  async getCrossmarkDownloadUrl(
    meetingId: string,
    _partnerId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    return this.presignComposite(meetingId);
  }

  async getAudioTracks(
    meetingId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      participantName: string;
      livekitIdentity: string;
      durationSeconds: number;
      url: string;
      expiresAt: string;
    }>
  > {
    await this.visibility.assertCanView(meetingId, userId);

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      include: { audioTracks: true },
    });
    if (!recording || recording.audioTracks.length === 0) return [];

    return Promise.all(
      recording.audioTracks.map(async (track) => {
        const key = extractKeyFromUrl(track.audioUrl, this.cfg.s3.bucket);
        const { url, expiresAt } = await this.s3.presignGet(key);
        return {
          id: track.id,
          participantName: track.participantName,
          livekitIdentity: track.livekitIdentity,
          durationSeconds: track.durationSeconds,
          url,
          expiresAt: expiresAt.toISOString(),
        };
      }),
    );
  }

  async deleteEarly(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      include: { audioTracks: true },
    });
    if (!recording) throw new RecordingNotFoundError(meetingId);
    if (recording.status === 'deleted') {
      throw new RecordingAlreadyDeletedError(meetingId);
    }

    const keys = this.collectKeys(recording);

    if (keys.length > 0) {
      await this.s3.delete(keys);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { meetingId },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      await tx.recordingAction.create({
        data: {
          recordingId: recording.id,
          action: 'deleted',
          actor: `user:${userId}`,
          reason: 'user_request',
        },
      });
    });

    this.metrics.incRecordingsDeleted({ reason: 'user_request' });
    this.logger.log(
      { meetingId, keys: keys.length },
      'Recording deleted by host',
    );
  }

  async extendRetention(
    meetingId: string,
    addDays: number,
    partnerId: string,
  ): Promise<{ expiresAt: Date }> {
    if (!Number.isInteger(addDays) || addDays <= 0) {
      throw new RecordingInvalidStateError(meetingId, 'invalid_add_days', 'positive_int');
    }

    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording) throw new RecordingNotFoundError(meetingId);
    if (recording.status === 'deleted') {
      throw new RecordingAlreadyDeletedError(meetingId);
    }

    const newExpiresAt = new Date(
      recording.expiresAt.getTime() + addDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { meetingId },
        data: {
          expiresAt: newExpiresAt,
          retentionDays: recording.retentionDays + addDays,
        },
      });
      await tx.recordingAction.create({
        data: {
          recordingId: recording.id,
          action: 'extended',
          actor: `partner:${partnerId}`,
          reason: `add_days:${addDays}`,
        },
      });
    });

    this.logger.log(
      { meetingId, addDays, newExpiresAt },
      'Recording retention extended',
    );

    return { expiresAt: newExpiresAt };
  }


  async findByMeetingId(meetingId: string): Promise<Recording | null> {
    return this.prisma.recording.findUnique({ where: { meetingId } });
  }

  async onCompositeEnded(
    meetingId: string,
    payload: { url: string | null; bytes: number | null; durationSeconds: number | null },
  ): Promise<{ status: RecordingStatus; allReady: boolean }> {
    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      include: { audioTracks: true },
    });
    if (!recording) {
      this.logger.warn({ meetingId }, 'onCompositeEnded: recording не найден');
      return { status: 'failed', allReady: false };
    }

    this.logger.debug(
      { meetingId, url: payload.url, bytes: payload.bytes, durationSeconds: payload.durationSeconds },
      'onCompositeEnded: сохраняем данные composite в БД',
    );

    await this.prisma.recording.update({
      where: { meetingId },
      data: {
        ...(payload.url !== null ? { mainVideoUrl: payload.url } : {}),
        ...(payload.bytes !== null ? { bytesTotal: BigInt(payload.bytes) } : {}),
        ...(payload.durationSeconds !== null
          ? { durationSeconds: payload.durationSeconds }
          : {}),
      },
    });

    if (payload.bytes !== null && payload.bytes > 0) {
      this.metrics.incRecordingsBytes(payload.bytes);
    }

    return this.tryFinalizeReady(meetingId);
  }

  async onTrackEnded(
    meetingId: string,
    trackEgressId: string,
    payload: {
      url: string | null;
      bytes: number | null;
      durationSeconds: number | null;
      endedAt: Date | null;
    },
  ): Promise<{ status: RecordingStatus; allReady: boolean }> {
    const audioTrack = await this.prisma.audioTrack.findFirst({
      where: { trackEgressId },
    });
    if (!audioTrack) {
      this.logger.warn({ meetingId, trackEgressId }, 'onTrackEnded: AudioTrack не найден');
      return this.tryFinalizeReady(meetingId);
    }

    this.logger.debug(
      { meetingId, trackEgressId, audioTrackId: audioTrack.id, url: payload.url, bytes: payload.bytes },
      'onTrackEnded: сохраняем данные аудиодорожки в БД',
    );

    await this.prisma.audioTrack.update({
      where: { id: audioTrack.id },
      data: {
        ...(payload.url !== null ? { audioUrl: payload.url } : {}),
        ...(payload.bytes !== null ? { bytes: BigInt(payload.bytes) } : {}),
        ...(payload.durationSeconds !== null
          ? { durationSeconds: payload.durationSeconds }
          : {}),
        ...(payload.endedAt !== null ? { endedAt: payload.endedAt } : {}),
      },
    });

    if (payload.bytes !== null && payload.bytes > 0) {
      this.metrics.incRecordingsBytes(payload.bytes);
    }

    return this.tryFinalizeReady(meetingId);
  }

  async markCompositeStarted(meetingId: string, egressId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording) return;
    if (recording.status === 'requested') {
      await this.prisma.recording.update({
        where: { meetingId },
        data: { status: 'recording', compositeEgressId: egressId },
      });
    }
  }

  async markFailed(meetingId: string, reason: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording) return;
    if (recording.status === 'deleted' || recording.status === 'archived') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.recording.update({
        where: { meetingId },
        data: { status: 'failed' },
      });
      await tx.recordingAction.create({
        data: {
          recordingId: recording.id,
          action: 'failed' as string,
          actor: 'system',
          reason,
        },
      });
    });
  }

  async reconcileCompositeEgress(
    meetingId: string,
  ): Promise<{ becameComplete: boolean; allReady: boolean; compositeBytes: number | null }> {
    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (
      !recording ||
      recording.mainVideoUrl ||
      ['ready', 'failed', 'deleted', 'archived', 'expired'].includes(recording.status)
    ) {
      return { becameComplete: false, allReady: false, compositeBytes: null };
    }

    const state = await this.egress.listCompositeEgress(meetingId);
    if (!state) return { becameComplete: false, allReady: false, compositeBytes: null };

    if (state.status === 'failed') {
      await this.markFailed(meetingId, 'egress_failed:reconcile');
      return { becameComplete: false, allReady: false, compositeBytes: null };
    }

    if (state.status !== 'complete' || !state.url) {
      return { becameComplete: false, allReady: false, compositeBytes: null };
    }

    const res = await this.onCompositeEnded(meetingId, {
      url: state.url,
      bytes: state.bytes,
      durationSeconds: state.durationSeconds,
    });
    this.logger.log(
      { meetingId, allReady: res.allReady },
      'reconcileCompositeEgress: composite догнан кроном',
    );
    return { becameComplete: true, allReady: res.allReady, compositeBytes: state.bytes };
  }

  private async tryFinalizeReady(
    meetingId: string,
  ): Promise<{ status: RecordingStatus; allReady: boolean }> {
    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      include: { audioTracks: true },
    });
    if (!recording) return { status: 'failed', allReady: false };

    const compositeReady = !!recording.mainVideoUrl;
    const allTracksReady = recording.audioTracks.every(
      (t) =>
        t.bytes !== null &&
        t.audioUrl &&
        !t.audioUrl.startsWith('s3://'),
    );

    const allReady = compositeReady && (recording.audioTracks.length === 0 || allTracksReady);

    this.logger.debug(
      {
        meetingId,
        compositeReady,
        allTracksReady,
        tracksTotal: recording.audioTracks.length,
        allReady,
        currentStatus: recording.status,
      },
      'tryFinalizeReady: проверяем готовность записи',
    );

    if (allReady && recording.status !== 'ready' && recording.status !== 'deleted') {
      await this.prisma.recording.update({
        where: { meetingId },
        data: { status: 'ready' },
      });
      return { status: 'ready', allReady: true };
    }

    if (recording.status === 'recording' || recording.status === 'requested') {
      await this.prisma.recording.update({
        where: { meetingId },
        data: { status: 'finalizing' },
      });
      return { status: 'finalizing', allReady: false };
    }

    return { status: recording.status, allReady };
  }


  private async presignComposite(
    meetingId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const recording = await this.prisma.recording.findUnique({ where: { meetingId } });
    if (!recording) throw new RecordingNotFoundError(meetingId);
    if (recording.status !== 'ready') {
      throw new RecordingNotReadyError(meetingId);
    }
    if (!recording.mainVideoUrl) {
      throw new RecordingNotReadyError(meetingId);
    }
    const key = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
    return this.s3.presignGet(key, undefined, {
      responseContentType: 'video/mp4',
      responseContentDisposition: 'inline',
    });
  }

  private collectKeys(recording: {
    mainVideoUrl: string | null;
    audioTracks: Array<{ audioUrl: string }>;
  }): string[] {
    const keys: string[] = [];
    if (recording.mainVideoUrl) {
      const k = extractKeyFromUrl(recording.mainVideoUrl, this.cfg.s3.bucket);
      if (k) keys.push(k);
    }
    for (const t of recording.audioTracks) {
      if (!t.audioUrl) continue;
      const k = extractKeyFromUrl(t.audioUrl, this.cfg.s3.bucket);
      if (k) keys.push(k);
    }
    return keys;
  }
}
