import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import {
  MeetingNotFoundError,
  NotAuthorizedError,
  RecordingInvalidStateError,
  RecordingNotFoundError,
  RecordingNotReadyError,
} from '../../common/errors/domain-errors';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LivekitService } from '../livekit/livekit.service';
import type { MeetingsService } from '../meetings/meetings.service';


import type { LivekitEgressClient } from './livekit-egress.client';
import { RecordingsService } from './recordings.service';
import type { S3Service } from './s3.service';

interface Recording {
  id: string;
  meetingId: string;
  status: string;
  retentionDays: number;
  expiresAt: Date;
  compositeEgressId: string | null;
  mainVideoUrl: string | null;
  audioTracks: Array<{
    id: string;
    audioUrl: string;
    bytes: bigint | null;
    trackEgressId: string | null;
    livekitIdentity: string;
  }>;
}

function makeService(setup: {
  meeting?: { id: string; ownerId: string; status: string } | null;
  recording?: Recording | null;
  participant?: { id: string } | null;
  audioTrack?: { id: string; trackEgressId: string | null } | null;
  egressStartId?: string;
  egressTrackStartId?: string;
  /** Что вернёт `livekit.listParticipants` (для reconcile-сверки). */
  livekitParticipants?: Array<{
    identity: string;
    name?: string;
    kind?: number;
    tracks?: Array<{ sid: string; type: number }>;
  }>;
  /** Если задан — `audioTrack.findFirst` вернёт его (имитация уже собранной дорожки). */
  existingAudioTrack?: { id: string } | null;
  recordingsForReconcile?: Array<{ meetingId: string }>;
  /** Что вернёт `egress.listCompositeEgress` (для composite-reconcile). */
  compositeEgressState?: {
    egressId: string;
    status: 'complete' | 'failed' | 'active';
    url: string | null;
    bytes: number | null;
    durationSeconds: number | null;
  } | null;
}): {
  svc: RecordingsService;
  prisma: any;
  egress: any;
  s3: any;
  metrics: any;
  cfg: any;
  livekit: any;
} {
  const meetingFindUnique = vi.fn(async () => setup.meeting ?? null);
  const recordingFindUnique = vi.fn(async (args: any) => {
    if (!setup.recording) return null;
    if (args.include) return setup.recording;
    return { ...setup.recording, audioTracks: undefined };
  });
  const recordingUpsert = vi.fn(async () => ({
    id: 'r-1',
    meetingId: setup.meeting?.id ?? 'm-1',
    status: 'requested',
  }));
  const recordingUpdate = vi.fn();
  const recordingActionCreate = vi.fn();
  const audioTrackFindFirst = vi.fn(async () => setup.existingAudioTrack ?? null);
  const participantFindUnique = vi.fn(async () => setup.participant ?? null);
  const audioTrackCreate = vi.fn();
  const audioTrackUpdate = vi.fn();
  const audioTrackUpdateMany = vi.fn();

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    recording: {
      findUnique: recordingFindUnique,
      upsert: recordingUpsert,
      update: recordingUpdate,
    },
    recordingAction: { create: recordingActionCreate },
    audioTrack: {
      findFirst: audioTrackFindFirst,
      create: audioTrackCreate,
      update: audioTrackUpdate,
      updateMany: audioTrackUpdateMany,
    },
    participant: { findUnique: participantFindUnique },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      // Mini-transaction: даём те же объекты как tx.
      await fn(prisma);
    },
  } as unknown as PrismaService;

  const egress = {
    startRoomCompositeEgress: vi.fn(async () => ({
      egressId: setup.egressStartId ?? 'EG_C1',
    })),
    startTrackEgress: vi.fn(async () => ({
      egressId: setup.egressTrackStartId ?? 'EG_T1',
    })),
    stopEgress: vi.fn(async () => undefined),
    listCompositeEgress: vi.fn(async () => setup.compositeEgressState ?? null),
  } as unknown as LivekitEgressClient;

  const s3 = {
    presignGet: vi.fn(async () => ({
      url: 'https://signed.local/url',
      expiresAt: new Date(Date.now() + 3600_000),
    })),
    delete: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const meetings = {
    transitionStatus: vi.fn(async () => undefined),
  } as unknown as MeetingsService;

  const metrics = {
    incRecordingsBytes: vi.fn(),
    incRecordingsDeleted: vi.fn(),
    incTrackEgressStartFailed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const livekit = {
    listParticipants: vi.fn(async () => setup.livekitParticipants ?? []),
  } as unknown as LivekitService;

  const cfg = {
    retention: { defaultDays: 30, cron: '0 * * * *' },
    s3: {
      endpointUrl: 'https://s3.local',
      region: 'ru-1',
      bucket: 'z-records',
      accessKey: 'AKIA',
      secretKey: 'SECRET',
      presignedTtlSeconds: 3600,
    },
  } as unknown as TypedConfigService;

  const svc = new RecordingsService(prisma, egress, s3, meetings, metrics, cfg, livekit);
  return { svc, prisma, egress, s3, metrics, cfg, livekit };
}

describe('RecordingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────── start ────────────────────────────────────

  it('start: meeting не найден → MeetingNotFoundError', async () => {
    const { svc } = makeService({ meeting: null });
    await expect(svc.start('m-1', 'u-1')).rejects.toBeInstanceOf(MeetingNotFoundError);
  });

  it('start: чужой owner → NotAuthorizedError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-other', status: 'active' },
    });
    await expect(svc.start('m-1', 'u-1')).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('start: meeting не в active → RecordingInvalidStateError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'scheduled' },
    });
    await expect(svc.start('m-1', 'u-1')).rejects.toBeInstanceOf(RecordingInvalidStateError);
  });

  it('start: запускает composite egress + сохраняет Recording + RecordingAction', async () => {
    const { svc, egress, prisma } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: null,
    });

    await svc.start('m-1', 'u-1');

    expect((egress as any).startRoomCompositeEgress).toHaveBeenCalledWith(
      { id: 'm-1' },
      expect.objectContaining({
        bucket: 'z-records',
        key: 'meetings/m-1/composite.mp4',
      }),
    );
    expect((prisma as any).recording.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        create: expect.objectContaining({
          meetingId: 'm-1',
          status: 'requested',
          retentionDays: 30,
        }),
      }),
    );
    expect((prisma as any).recordingAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'created',
          actor: 'user:u-1',
        }),
      }),
    );
  });

  // ─────────────────────────── stop ─────────────────────────────────────

  it('stop: чужой owner → NotAuthorizedError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-other', status: 'active' },
    });
    await expect(svc.stop('m-1', 'u-1')).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('stop: recording отсутствует → RecordingNotFoundError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: null,
    });
    await expect(svc.stop('m-1', 'u-1')).rejects.toBeInstanceOf(RecordingNotFoundError);
  });

  it('stop: останавливает composite + всех track egress\'ов и переводит в finalizing', async () => {
    const { svc, egress, prisma } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'recording',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: 'EG_C1',
        mainVideoUrl: null,
        audioTracks: [
          {
            id: 'a-1',
            audioUrl: 's3://z-records/k1',
            bytes: null,
            trackEgressId: 'EG_T1',
            livekitIdentity: 'guest:1',
          },
        ],
      },
    });

    await svc.stop('m-1', 'u-1');

    expect((egress as any).stopEgress).toHaveBeenCalledWith('EG_C1');
    expect((egress as any).stopEgress).toHaveBeenCalledWith('EG_T1');
    expect((prisma as any).recording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        data: { status: 'finalizing' },
      }),
    );
  });

  // ─────────────────────────── ensureTrackEgress ─────────────────────────

  it('ensureTrackEgress: recording не активна → no-op', async () => {
    const { svc, egress } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'finalizing',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: null,
        mainVideoUrl: null,
        audioTracks: [],
      },
    });

    await svc.ensureTrackEgress(
      { id: 'm-1' },
      { identity: 'guest:1', name: 'G' },
      { sid: 'TR_1' },
    );

    expect((egress as any).startTrackEgress).not.toHaveBeenCalled();
  });

  it('ensureTrackEgress: создаёт AudioTrack и стартует track egress', async () => {
    const { svc, egress, prisma } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'recording',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: 'EG_C1',
        mainVideoUrl: null,
        audioTracks: [],
      },
      participant: { id: 'p-1' },
    });

    await svc.ensureTrackEgress(
      { id: 'm-1' },
      { identity: 'guest:1', name: 'Гость' },
      { sid: 'TR_1' },
    );

    expect((egress as any).startTrackEgress).toHaveBeenCalledWith(
      { id: 'm-1' },
      'TR_1',
      expect.objectContaining({
        bucket: 'z-records',
        key: 'meetings/m-1/audio/guest:1.ogg',
      }),
    );
    expect((prisma as any).audioTrack.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordingId: 'r-1',
          participantId: 'p-1',
          livekitIdentity: 'guest:1',
          trackId: 'TR_1',
          trackEgressId: 'EG_T1',
        }),
      }),
    );
  });

  it('ensureTrackEgress: провал старта egress → метрика + AudioTrack не создаётся', async () => {
    const { svc, egress, prisma, metrics } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'recording',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: 'EG_C1',
        mainVideoUrl: null,
        audioTracks: [],
      },
      participant: { id: 'p-1' },
    });
    (egress as any).startTrackEgress.mockRejectedValueOnce(new Error('egress capacity'));

    await svc.ensureTrackEgress(
      { id: 'm-1' },
      { identity: 'guest:1', name: 'Гость' },
      { sid: 'TR_1' },
    );

    expect((metrics as any).incTrackEgressStartFailed).toHaveBeenCalledWith({
      reason: 'start_failed',
    });
    expect((prisma as any).audioTrack.create).not.toHaveBeenCalled();
  });

  // ─────────────────────────── reconcileTrackEgress ──────────────────────

  const activeRecording = (): Recording => ({
    id: 'r-1',
    meetingId: 'm-1',
    status: 'recording',
    retentionDays: 30,
    expiresAt: new Date(),
    compositeEgressId: 'EG_C1',
    mainVideoUrl: null,
    audioTracks: [],
  });

  it('reconcileTrackEgress: догоняет AUDIO-треки STANDARD-участников (pull)', async () => {
    const { svc, egress } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: activeRecording(),
      participant: { id: 'p-1' },
      livekitParticipants: [
        { identity: 'host:u-1', name: 'Хост', kind: 0, tracks: [{ sid: 'TR_A', type: 0 }] },
        { identity: 'guest:g1', name: 'Гость', kind: 0, tracks: [{ sid: 'TR_B', type: 0 }] },
      ],
    });

    await svc.reconcileTrackEgress('m-1');

    expect((egress as any).startTrackEgress).toHaveBeenCalledTimes(2);
    expect((egress as any).startTrackEgress).toHaveBeenCalledWith(
      { id: 'm-1' },
      'TR_A',
      expect.objectContaining({ key: 'meetings/m-1/audio/host:u-1.ogg' }),
    );
    expect((egress as any).startTrackEgress).toHaveBeenCalledWith(
      { id: 'm-1' },
      'TR_B',
      expect.objectContaining({ key: 'meetings/m-1/audio/guest:g1.ogg' }),
    );
  });

  it('reconcileTrackEgress: пропускает egress-рекордеров (kind=EGRESS) и video-треки', async () => {
    const { svc, egress } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: activeRecording(),
      participant: { id: 'p-1' },
      livekitParticipants: [
        // egress-рекордер — kind=EGRESS(2): пропустить целиком.
        { identity: 'EG_xyz', kind: 2, tracks: [{ sid: 'TR_E', type: 0 }] },
        // реальный участник, но трек видео (type=VIDEO=1): пропустить трек.
        { identity: 'host:u-1', name: 'Хост', kind: 0, tracks: [{ sid: 'TR_V', type: 1 }] },
      ],
    });

    await svc.reconcileTrackEgress('m-1');

    expect((egress as any).startTrackEgress).not.toHaveBeenCalled();
  });

  it('reconcileTrackEgress: existing AudioTrack → не стартует повторный egress (идемпотентность)', async () => {
    const { svc, egress } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: activeRecording(),
      existingAudioTrack: { id: 'a-1' },
      livekitParticipants: [
        { identity: 'host:u-1', name: 'Хост', kind: 0, tracks: [{ sid: 'TR_A', type: 0 }] },
      ],
    });

    await svc.reconcileTrackEgress('m-1');

    expect((egress as any).startTrackEgress).not.toHaveBeenCalled();
  });

  it('reconcileTrackEgress: recording не активна → не дёргает listParticipants', async () => {
    const { svc, livekit } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: { ...activeRecording(), status: 'finalizing' },
      livekitParticipants: [
        { identity: 'host:u-1', kind: 0, tracks: [{ sid: 'TR_A', type: 0 }] },
      ],
    });

    await svc.reconcileTrackEgress('m-1');

    expect((livekit as any).listParticipants).not.toHaveBeenCalled();
  });

  it('reconcileTrackEgress: записи нет → no-op', async () => {
    const { svc, livekit } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'active' },
      recording: null,
    });

    await svc.reconcileTrackEgress('m-1');

    expect((livekit as any).listParticipants).not.toHaveBeenCalled();
  });

  // ─────────────────────────── getDownloadUrl ────────────────────────────

  it('getDownloadUrl: чужой owner → NotAuthorizedError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-other', status: 'completed' },
    });
    await expect(svc.getDownloadUrl('m-1', 'u-1')).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it('getDownloadUrl: recording не ready → RecordingNotReadyError', async () => {
    const { svc } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'completed' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'finalizing',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: null,
        mainVideoUrl: null,
        audioTracks: [],
      },
    });
    await expect(svc.getDownloadUrl('m-1', 'u-1')).rejects.toBeInstanceOf(
      RecordingNotReadyError,
    );
  });

  it('getDownloadUrl: отдаёт presigned URL', async () => {
    const { svc, s3 } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'recording_ready' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: null,
        mainVideoUrl:
          'https://s3.local/z-records/meetings/m-1/composite.mp4',
        audioTracks: [],
      },
    });

    const result = await svc.getDownloadUrl('m-1', 'u-1');

    expect(result.url).toBe('https://signed.local/url');
    // Composite отдаётся как inline video/mp4 (иначе octet-stream ломает плеер).
    expect((s3 as any).presignGet).toHaveBeenCalledWith(
      'meetings/m-1/composite.mp4',
      undefined,
      { responseContentType: 'video/mp4', responseContentDisposition: 'inline' },
    );
  });

  // ─────────────────────────── deleteEarly ───────────────────────────────

  it('deleteEarly: удаляет S3-объекты и помечает recording как deleted', async () => {
    const { svc, s3, prisma, metrics } = makeService({
      meeting: { id: 'm-1', ownerId: 'u-1', status: 'recording_ready' },
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: null,
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        audioTracks: [
          {
            id: 'a-1',
            audioUrl: 'https://s3.local/z-records/meetings/m-1/audio/guest:1.ogg',
            bytes: null,
            trackEgressId: 'EG_T1',
            livekitIdentity: 'guest:1',
          },
        ],
      },
    });

    await svc.deleteEarly('m-1', 'u-1');

    expect((s3 as any).delete).toHaveBeenCalledWith([
      'meetings/m-1/composite.mp4',
      'meetings/m-1/audio/guest:1.ogg',
    ]);
    expect((prisma as any).recording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'deleted' }),
      }),
    );
    expect((metrics as any).incRecordingsDeleted).toHaveBeenCalledWith({
      reason: 'user_request',
    });
  });

  // ─────────────────────────── extendRetention ───────────────────────────

  it('extendRetention: addDays добавляется к expiresAt', async () => {
    const expiresAt = new Date('2026-06-01T00:00:00Z');
    const { svc, prisma } = makeService({
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        retentionDays: 30,
        expiresAt,
        compositeEgressId: null,
        mainVideoUrl: null,
        audioTracks: [],
      },
    });

    const result = await svc.extendRetention('m-1', 7, 'partner-A');

    const expected = new Date(expiresAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(result.expiresAt.toISOString()).toBe(expected.toISOString());
    expect((prisma as any).recordingAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'extended',
          actor: 'partner:partner-A',
          reason: 'add_days:7',
        }),
      }),
    );
  });

  it('extendRetention: addDays <= 0 → RecordingInvalidStateError', async () => {
    const { svc } = makeService({
      recording: {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        retentionDays: 30,
        expiresAt: new Date(),
        compositeEgressId: null,
        mainVideoUrl: null,
        audioTracks: [],
      },
    });
    await expect(svc.extendRetention('m-1', 0, 'p-A')).rejects.toBeInstanceOf(
      RecordingInvalidStateError,
    );
  });

  // ─────────────────────────── reconcileCompositeEgress ──────────────────

  const finalizingRecording = (over?: Partial<Recording>): Recording => ({
    id: 'r-1',
    meetingId: 'm-1',
    status: 'finalizing',
    retentionDays: 30,
    expiresAt: new Date(),
    compositeEgressId: 'EG_C1',
    mainVideoUrl: null,
    audioTracks: [],
    ...over,
  });

  it('reconcileCompositeEgress: COMPLETE без mainVideoUrl → финализирует через onCompositeEnded', async () => {
    const { svc, egress } = makeService({
      recording: finalizingRecording(),
      compositeEgressState: {
        egressId: 'EG_C1',
        status: 'complete',
        url: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        bytes: 123_456,
        durationSeconds: 600,
      },
    });
    // Изолируем от внутренней логики onCompositeEnded — проверяем сам reconcile-контракт.
    const onCompositeEnded = vi
      .spyOn(svc, 'onCompositeEnded')
      .mockResolvedValue({ status: 'ready', allReady: true });

    const res = await svc.reconcileCompositeEgress('m-1');

    expect((egress as any).listCompositeEgress).toHaveBeenCalledWith('m-1');
    expect(onCompositeEnded).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({
        url: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        bytes: 123_456,
        durationSeconds: 600,
      }),
    );
    expect(res).toEqual(
      expect.objectContaining({ becameComplete: true, allReady: true, compositeBytes: 123_456 }),
    );
  });

  it('reconcileCompositeEgress: mainVideoUrl уже задан → no-op, LiveKit не дёргаем', async () => {
    const { svc, egress } = makeService({
      recording: finalizingRecording({
        status: 'recording',
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
      }),
      compositeEgressState: {
        egressId: 'EG_C1',
        status: 'complete',
        url: 'https://s3.local/x.mp4',
        bytes: 1,
        durationSeconds: 1,
      },
    });
    const onCompositeEnded = vi.spyOn(svc, 'onCompositeEnded');

    const res = await svc.reconcileCompositeEgress('m-1');

    expect((egress as any).listCompositeEgress).not.toHaveBeenCalled();
    expect(onCompositeEnded).not.toHaveBeenCalled();
    expect(res).toEqual(
      expect.objectContaining({ becameComplete: false, compositeBytes: null }),
    );
  });

  it('reconcileCompositeEgress: LiveKit FAILED → markFailed(egress_failed:reconcile)', async () => {
    const { svc } = makeService({
      recording: finalizingRecording(),
      compositeEgressState: {
        egressId: 'EG_C1',
        status: 'failed',
        url: null,
        bytes: null,
        durationSeconds: null,
      },
    });
    const markFailed = vi.spyOn(svc, 'markFailed').mockResolvedValue(undefined);

    const res = await svc.reconcileCompositeEgress('m-1');

    expect(markFailed).toHaveBeenCalledWith('m-1', 'egress_failed:reconcile');
    expect(res).toEqual(
      expect.objectContaining({ becameComplete: false, allReady: false }),
    );
  });

  it('reconcileCompositeEgress: composite ещё active → no-op (becameComplete:false)', async () => {
    const { svc } = makeService({
      recording: finalizingRecording(),
      compositeEgressState: {
        egressId: 'EG_C1',
        status: 'active',
        url: null,
        bytes: null,
        durationSeconds: null,
      },
    });
    const onCompositeEnded = vi.spyOn(svc, 'onCompositeEnded');

    const res = await svc.reconcileCompositeEgress('m-1');

    expect(onCompositeEnded).not.toHaveBeenCalled();
    expect(res.becameComplete).toBe(false);
  });
});
