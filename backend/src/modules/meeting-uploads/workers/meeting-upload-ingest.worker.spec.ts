import { writeFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';
import type { MeetingUploadsQueueService } from '../meeting-uploads-queue.service';

import { MeetingUploadIngestWorker } from './meeting-upload-ingest.worker';

/**
 * Тестовый подкласс: переопределяет `runFfmpeg` (пишет out-файл, чтобы
 * `readFile` отработал на реальном fs) и `runFfprobe` (возвращает заданный
 * JSON). Так воркер тестируется БЕЗ реального ffmpeg.
 */
class TestIngestWorker extends MeetingUploadIngestWorker {
  public ffmpegCalls: string[][] = [];
  public probeJson = '';
  public probeShouldThrow = false;

  protected override async runFfmpeg(args: string[]): Promise<void> {
    this.ffmpegCalls.push(args);
    const outPath = args[args.length - 1];
    if (!outPath) throw new Error('test runFfmpeg: нет out-пути');
    await writeFile(outPath, Buffer.from('NORMALIZED_MEDIA'));
  }

  protected override async runFfprobe(_args: string[]): Promise<string> {
    if (this.probeShouldThrow) throw new Error('ffprobe failed');
    return this.probeJson;
  }
}

function make(probe: { json?: string; throws?: boolean }): {
  worker: TestIngestWorker;
  prisma: any;
  s3: any;
  meetings: any;
  queue: any;
} {
  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => ({
        id: 'm-1',
        source: 'upload',
        status: 'scheduled',
        tenantId: 'org-1',
      })),
    },
    recording: { upsert: vi.fn(async () => ({ id: 'rec-1' })) },
  } as unknown as PrismaService;

  const s3 = {
    listKeys: vi.fn(async () => ['meetings/m-1/upload/source.mp4']),
    getObject: vi.fn(async () => Buffer.from('SOURCE_BYTES')),
    putObject: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const meetings = {
    transitionStatus: vi.fn(async () => ({ id: 'm-1' })),
  } as unknown as MeetingsService;

  const queue = {
    enqueueUploadTranscribe: vi.fn(async () => ({ jobId: 'job-tr-1' })),
  } as unknown as MeetingUploadsQueueService;

  const redis = { client: {} } as unknown as RedisService;
  const cfg = {
    s3: { bucket: 'z-records' },
    retention: { defaultDays: 30 },
  } as unknown as TypedConfigService;

  const worker = new TestIngestWorker(redis, prisma, s3, cfg, meetings, queue);
  worker.probeJson = probe.json ?? '';
  worker.probeShouldThrow = probe.throws ?? false;
  return { worker, prisma, s3, meetings, queue };
}

const PROBE_AUDIO_ONLY = JSON.stringify({
  streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
  format: { format_name: 'mp3' },
});
const PROBE_NATIVE_MP4 = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
});
const PROBE_NO_AUDIO = JSON.stringify({
  streams: [{ codec_type: 'video', codec_name: 'h264' }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
});

describe('MeetingUploadIngestWorker.processMeeting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('аудио присутствует → заливает аудио, Recording.ready, FSM recording_ready, enqueue transcribe', async () => {
    const { worker, prisma, s3, meetings, queue } = make({ json: PROBE_AUDIO_ONLY });

    await worker.processMeeting('m-1');

    // Нормализованное аудио залито (mono 16к opus → audio.ogg).
    const putCalls = (s3 as any).putObject.mock.calls.map((c: any[]) => c[0]);
    expect(putCalls.some((a: any) => a.key === 'meetings/m-1/upload/audio.ogg')).toBe(true);
    // ffmpeg вызван с нормализацией аудио.
    expect(worker.ffmpegCalls[0]).toEqual(
      expect.arrayContaining(['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus']),
    );
    // Recording создан/обновлён как ready.
    const upsertArg = (prisma as any).recording.upsert.mock.calls[0][0];
    expect(upsertArg.create.status).toBe('ready');
    expect(upsertArg.create.retentionDays).toBe(30);
    // FSM: scheduled→recording_processing→recording_ready.
    const transitions = (meetings as any).transitionStatus.mock.calls.map((c: any[]) => c[1]);
    expect(transitions).toContain('recording_processing');
    expect(transitions).toContain('recording_ready');
    // Дальше — transcribe.
    expect((queue as any).enqueueUploadTranscribe).toHaveBeenCalledWith('m-1');
  });

  it('нативный mp4 (h264+aac) → faststart-ремукс пишет mainVideoUrl', async () => {
    const { worker, prisma, s3 } = make({ json: PROBE_NATIVE_MP4 });

    await worker.processMeeting('m-1');

    // faststart-ремукс по compositeKey.
    const putCalls = (s3 as any).putObject.mock.calls.map((c: any[]) => c[0]);
    expect(putCalls.some((a: any) => a.key === 'meetings/m-1/composite.mp4')).toBe(true);
    expect(worker.ffmpegCalls.some((a) => a.includes('+faststart'))).toBe(true);
    const upsertArg = (prisma as any).recording.upsert.mock.calls[0][0];
    expect(upsertArg.create.mainVideoUrl).toBe('s3://z-records/meetings/m-1/composite.mp4');
  });

  it('нет аудио-дорожки → FSM failed + UPLOAD_NO_AUDIO_STREAM, transcribe НЕ ставится', async () => {
    const { worker, meetings, queue } = make({ json: PROBE_NO_AUDIO });

    await expect(worker.processMeeting('m-1')).rejects.toThrow(/UPLOAD_NO_AUDIO_STREAM/);

    const failCall = (meetings as any).transitionStatus.mock.calls.find(
      (c: any[]) => c[1] === 'failed',
    );
    expect(failCall).toBeTruthy();
    expect(failCall[2].failureReason).toMatch(/UPLOAD_NO_AUDIO_STREAM/);
    expect((queue as any).enqueueUploadTranscribe).not.toHaveBeenCalled();
  });

  it('ffprobe-сбой → UPLOAD_DECODE_FAILED', async () => {
    const { worker, meetings } = make({ throws: true });

    await expect(worker.processMeeting('m-1')).rejects.toThrow(/UPLOAD_DECODE_FAILED/);
    const failCall = (meetings as any).transitionStatus.mock.calls.find(
      (c: any[]) => c[1] === 'failed',
    );
    expect(failCall).toBeTruthy();
  });

  it('встреча не в scheduled (повторный ingest) → no-op', async () => {
    const { worker, prisma, s3 } = make({ json: PROBE_AUDIO_ONLY });
    (prisma as any).meeting.findUnique.mockResolvedValueOnce({
      id: 'm-1',
      source: 'upload',
      status: 'recording_ready',
      tenantId: 'org-1',
    });

    await worker.processMeeting('m-1');

    expect((s3 as any).getObject).not.toHaveBeenCalled();
    expect((prisma as any).recording.upsert).not.toHaveBeenCalled();
  });
});
