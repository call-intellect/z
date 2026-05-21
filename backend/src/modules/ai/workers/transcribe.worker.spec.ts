import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';
import type { AiQueueService } from '../ai-queue.service';
import type { AiUsageLogService } from '../services/ai-usage-log.service';
import type { VoxService } from '../services/vox.service';

import { TranscribeWorker } from './transcribe.worker';

/**
 * `TranscribeWorker.process` тестируется как чистая функция через
 * `(worker as any).process(job)`. BullMQ Worker сам не запускаем —
 * `onModuleInit` пропускаем.
 */

describe('TranscribeWorker.process (happy path)', () => {
  it('тянет audio, отправляет в Vox, складывает per-track + index, ставит merge', async () => {
    const meetingId = 'm-1';
    const meetingFindUnique = vi.fn(async () => ({
      id: meetingId,
      type: 'sales',
      status: 'recording_ready',
      recording: {
        id: 'r-1',
        audioTracks: [
          {
            id: 'at-1',
            participantId: 'p-1',
            participantName: 'Alice',
            livekitIdentity: 'host:alice',
            audioUrl: 's3://bucket/meetings/m-1/audio/host_alice.ogg',
            startedAt: new Date('2026-05-08T10:00:00.000Z'),
            endedAt: new Date('2026-05-08T10:05:00.000Z'),
            durationSeconds: 300,
            bytes: 12345n,
            recordingId: 'r-1',
            trackId: 't1',
            trackEgressId: 'egr-1',
          },
          {
            id: 'at-2',
            participantId: 'p-2',
            participantName: 'Bob',
            livekitIdentity: 'guest:bob',
            audioUrl: 's3://bucket/meetings/m-1/audio/guest_bob.ogg',
            startedAt: new Date('2026-05-08T10:00:05.000Z'),
            endedAt: new Date('2026-05-08T10:05:00.000Z'),
            durationSeconds: 295,
            bytes: 11000n,
            recordingId: 'r-1',
            trackId: 't2',
            trackEgressId: 'egr-2',
          },
        ],
      },
      transcript: { tracks: [] },
    }));
    const transcriptUpsert = vi.fn(async () => ({ id: 'tr-1' }));
    const transcriptTrackCreate = vi.fn(async () => undefined);
    const prisma = {
      meeting: { findUnique: meetingFindUnique },
      transcript: { upsert: transcriptUpsert },
      transcriptTrack: { create: transcriptTrackCreate },
    } as unknown as PrismaService;

    const transitionStatus = vi.fn(async () => undefined);
    const meetings = { transitionStatus } as unknown as MeetingsService;

    const submit = vi.fn(async () => ({ taskId: 'task-1' }));
    const poll = vi.fn(async () => ({
      status: 'COMPLETED' as const,
      transcriptText: 'Привет команда',
      durationSeconds: 5,
      words: [
        { word: 'Привет', startMs: 0, endMs: 500 },
        { word: 'команда', startMs: 600, endMs: 1100 },
      ],
    }));
    const vox = { submit, poll } as unknown as VoxService;

    const getObject = vi.fn(async () => Buffer.from('audio-bytes'));
    const putJson = vi.fn(async () => undefined);
    const s3 = { getObject, putJson } as unknown as S3Service;

    const enqueueMerge = vi.fn(async () => undefined);
    const queue = { enqueueMerge } as unknown as AiQueueService;

    const observe = vi.fn();
    const incFailed = vi.fn();
    const metrics = {
      observeAiPipelineDuration: observe,
      incMeetingFailed: incFailed,
    } as unknown as BusinessMetricsService;

    const usageRecord = vi.fn(async () => undefined);
    const usage = { record: usageRecord } as unknown as AiUsageLogService;

    const cfg = {
      ai: { vox: { model: 'v3_rnnt' } },
      s3: { bucket: 'bucket' },
    } as unknown as TypedConfigService;

    const redis = { client: {} } as unknown as RedisService;

    const worker = new TranscribeWorker(
      redis,
      prisma,
      vox,
      s3,
      queue,
      meetings,
      metrics,
      usage,
      cfg,
    );
    // Вызовем приватный process через cast.
    await (
      worker as unknown as { process: (j: unknown) => Promise<void> }
    ).process({ data: { meetingId, attempt: 1 }, id: 'job-1' });

    expect(transitionStatus).toHaveBeenCalledWith(meetingId, 'transcription_processing', expect.any(Object));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledTimes(2);
    // Данные треков сохраняются в БД (2 трека).
    expect(transcriptTrackCreate).toHaveBeenCalledTimes(2);
    expect(transcriptUpsert).toHaveBeenCalledOnce();
    expect(enqueueMerge).toHaveBeenCalledWith(meetingId);
    expect(observe).toHaveBeenCalled();
    // 2 vox usage records (transcribe).
    expect(usageRecord).toHaveBeenCalledTimes(2);
  });

  it('идемпотентность: уже есть TranscriptTrack → сразу enqueueMerge', async () => {
    const meetingFindUnique = vi.fn(async () => ({
      id: 'm-2',
      type: 'team',
      status: 'transcription_processing',
      recording: { audioTracks: [] },
      transcript: { tracks: [{ id: 'trk-1' }] },
    }));
    const prisma = {
      meeting: { findUnique: meetingFindUnique },
      transcript: { upsert: vi.fn() },
    } as unknown as PrismaService;
    const meetings = { transitionStatus: vi.fn() } as unknown as MeetingsService;
    const enqueueMerge = vi.fn(async () => undefined);
    const queue = { enqueueMerge } as unknown as AiQueueService;
    const submit = vi.fn();
    const vox = { submit, poll: vi.fn() } as unknown as VoxService;
    const s3 = { getObject: vi.fn(), putJson: vi.fn() } as unknown as S3Service;
    const usage = { record: vi.fn() } as unknown as AiUsageLogService;
    const metrics = {
      observeAiPipelineDuration: vi.fn(),
      incMeetingFailed: vi.fn(),
    } as unknown as BusinessMetricsService;
    const cfg = {
      ai: { vox: { model: 'v3_rnnt' } },
      s3: { bucket: 'bucket' },
    } as unknown as TypedConfigService;
    const redis = { client: {} } as unknown as RedisService;

    const worker = new TranscribeWorker(redis, prisma, vox, s3, queue, meetings, metrics, usage, cfg);
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId: 'm-2', attempt: 1 },
      id: 'j',
    });

    expect(submit).not.toHaveBeenCalled();
    expect(enqueueMerge).toHaveBeenCalledWith('m-2');
  });
});
