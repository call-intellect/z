import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import { LivekitEventsHandler } from '../../webhooks/livekit-events.handler';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';
import type { AiQueueService } from '../ai-queue.service';
import type { AiUsageLogService } from '../services/ai-usage-log.service';
import type { VoxService } from '../services/vox.service';

import { TranscribeWorker } from './transcribe.worker';

type AnyTrack = {
  id: string;
  participantId: string | null;
  participantName: string;
  livekitIdentity: string;
  audioUrl: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  bytes: bigint | null;
  recordingId: string;
  trackId: string;
  trackEgressId: string | null;
  voxTaskId: string | null;
};

function track(partial: Partial<AnyTrack> & Pick<AnyTrack, 'id' | 'livekitIdentity'>): AnyTrack {
  return {
    participantId: 'p-' + partial.id,
    participantName: 'Speaker ' + partial.id,
    audioUrl: `s3://bucket/meetings/m/audio/${partial.id}.ogg`,
    startedAt: new Date('2026-05-08T10:00:00.000Z'),
    endedAt: new Date('2026-05-08T10:05:00.000Z'),
    durationSeconds: 300,
    bytes: 12345n,
    recordingId: 'r-1',
    trackId: 't-' + partial.id,
    trackEgressId: 'egr-' + partial.id,
    voxTaskId: null,
    ...partial,
  };
}

const completedResult = {
  status: 'COMPLETED' as const,
  transcriptText: 'Привет команда',
  durationSeconds: 5,
  words: [
    { word: 'Привет', startMs: 0, endMs: 500 },
    { word: 'команда', startMs: 600, endMs: 1100 },
  ],
};

interface Deps {
  prisma: PrismaService;
  vox: VoxService;
  s3: S3Service;
  queue: AiQueueService;
  meetings: MeetingsService;
  metrics: BusinessMetricsService;
  usage: AiUsageLogService;
  cfg: TypedConfigService;
  redis: RedisService;
  submit: ReturnType<typeof vi.fn>;
  poll: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  enqueueMerge: ReturnType<typeof vi.fn>;
  audioTrackUpdate: ReturnType<typeof vi.fn>;
  transcriptTrackFindUnique: ReturnType<typeof vi.fn>;
  transcriptTrackCount: ReturnType<typeof vi.fn>;
}

function makeWorker(opts: {
  meetingId?: string;
  status?: string;
  tracks: AnyTrack[];
  pollImpl?: (taskId: string) => Promise<typeof completedResult>;
  existingByIdentity?: Record<string, unknown>;
  hasTranscript?: boolean;
  failedIdentities?: string[];
}): { worker: TranscribeWorker; deps: Deps } {
  const meetingId = opts.meetingId ?? 'm-1';
  const existing = opts.existingByIdentity ?? {};
  const failed = new Set(opts.failedIdentities ?? []);
  const hasTranscript = opts.hasTranscript ?? true;

  const persisted = new Set<string>(Object.keys(existing));

  const meetingFindUnique = vi.fn(async () => ({
    id: meetingId,
    type: 'sales',
    status: opts.status ?? 'recording_ready',
    recording: { id: 'r-1', audioTracks: opts.tracks },
    transcript: hasTranscript ? { id: 'tr-1' } : null,
  }));
  const transcriptUpsert = vi.fn(async () => ({ id: 'tr-1' }));
  const upsert = vi.fn(async (args: { create: { livekitIdentity: string } }) => {
    const identity = args.create.livekitIdentity;
    if (!failed.has(identity)) persisted.add(identity);
    return undefined;
  });
  const audioTrackUpdate = vi.fn(async () => undefined);
  const transcriptTrackFindUnique = vi.fn(
    async (args: { where: { transcriptId_livekitIdentity: { livekitIdentity: string } } }) => {
      const identity = args.where.transcriptId_livekitIdentity.livekitIdentity;
      return existing[identity] ?? null;
    },
  );
  const transcriptTrackCount = vi.fn(async () => persisted.size);

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    transcript: { upsert: transcriptUpsert },
    transcriptTrack: {
      findUnique: transcriptTrackFindUnique,
      upsert,
      count: transcriptTrackCount,
    },
    audioTrack: { update: audioTrackUpdate },
  } as unknown as PrismaService;

  const submit = vi.fn(async () => ({ taskId: 'task-' + Math.random().toString(36).slice(2, 8) }));
  const poll = vi.fn(opts.pollImpl ?? (async () => completedResult));
  const vox = { submit, poll } as unknown as VoxService;

  const s3 = {
    getObject: vi.fn(async () => Buffer.from('audio-bytes')),
    putJson: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const enqueueMerge = vi.fn(async () => undefined);
  const queue = { enqueueMerge } as unknown as AiQueueService;

  const meetings = { transitionStatus: vi.fn(async () => undefined) } as unknown as MeetingsService;
  const metrics = {
    observeAiPipelineDuration: vi.fn(),
    incMeetingFailed: vi.fn(),
  } as unknown as BusinessMetricsService;
  const usage = { record: vi.fn(async () => undefined) } as unknown as AiUsageLogService;
  const cfg = {
    ai: { vox: { model: 'v3_rnnt', pollIntervalMs: 5000, pollMaxAttempts: 180 } },
    s3: { bucket: 'bucket' },
    getDynamic: vi.fn(async (_k: string, _e: unknown, d: number) => d),
  } as unknown as TypedConfigService;
  const redis = { client: {} } as unknown as RedisService;

  const worker = new TranscribeWorker(redis, prisma, vox, s3, queue, meetings, metrics, usage, cfg);

  return {
    worker,
    deps: {
      prisma,
      vox,
      s3,
      queue,
      meetings,
      metrics,
      usage,
      cfg,
      redis,
      submit,
      poll,
      upsert,
      enqueueMerge,
      audioTrackUpdate,
      transcriptTrackFindUnique,
      transcriptTrackCount,
    },
  };
}

async function run(worker: TranscribeWorker, meetingId = 'm-1'): Promise<void> {
  await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
    data: { meetingId, attempt: 1 },
    id: 'job-1',
  });
}

describe('TranscribeWorker.process', () => {
  it('happy path: тянет audio, submit+poll(с опциями), upsert per-track, merge один раз', async () => {
    const { worker, deps } = makeWorker({
      tracks: [
        track({ id: 'a', livekitIdentity: 'host:alice' }),
        track({ id: 'b', livekitIdentity: 'guest:bob' }),
      ],
    });
    await run(worker);

    expect(deps.submit).toHaveBeenCalledTimes(2);
    expect(deps.poll).toHaveBeenCalledTimes(2);
    expect(deps.poll).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ intervalMs: 5000, maxAttempts: 180 }),
    );
    expect(deps.upsert).toHaveBeenCalledTimes(2);
    expect(deps.enqueueMerge).toHaveBeenCalledTimes(1);
    expect(deps.enqueueMerge).toHaveBeenCalledWith('m-1');
  });

  it('сохраняет voxTaskId ДО poll: submit → audioTrack.update(voxTaskId) → poll', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
    });
    await run(worker);

    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.audioTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a' },
        data: expect.objectContaining({ voxTaskId: expect.any(String) }),
      }),
    );
  });

  it('параллель + allSettled: одна дорожка падает → две успешные upsert, merge НЕ ставится, ошибка', async () => {
    const failingIdentity = 'guest:bob';
    const _pollImpl = vi.fn(async (_taskId: string) => {
      return completedResult;
    });
    const { worker, deps } = makeWorker({
      tracks: [
        track({ id: 'a', livekitIdentity: 'host:alice' }),
        track({ id: 'b', livekitIdentity: failingIdentity }),
        track({ id: 'c', livekitIdentity: 'guest:carol' }),
      ],
    });

    const taskByIdentity: Record<string, string> = {};
    let n = 0;
    (deps.submit as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const taskId = `task-${n++}`;
      return { taskId };
    });
    (deps.audioTrackUpdate as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where: { id: string }; data: { voxTaskId?: string | null } }) => {
        if (args.data.voxTaskId) taskByIdentity[args.where.id] = args.data.voxTaskId;
        return undefined;
      },
    );
    (deps.poll as ReturnType<typeof vi.fn>).mockImplementation(async (taskId: string) => {
      if (taskByIdentity['b'] === taskId) {
        throw new Error('vox poll failed for track b');
      }
      return completedResult;
    });

    await expect(run(worker)).rejects.toThrow(/не все дорожки/i);

    expect(deps.upsert).toHaveBeenCalledTimes(2);
    expect(deps.enqueueMerge).not.toHaveBeenCalled();
  });

  it('идемпотентность: дорожка с существующим TranscriptTrack пропускается (нет submit/poll)', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
      existingByIdentity: {
        'host:alice': {
          speakerName: 'Alice',
          transcriptText: 'уже есть',
          durationSeconds: 10,
          words: [{ word: 'уже', startMs: 0, endMs: 100 }],
        },
      },
    });
    await run(worker);

    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.poll).not.toHaveBeenCalled();
    expect(deps.upsert).not.toHaveBeenCalled();
    expect(deps.enqueueMerge).toHaveBeenCalledTimes(1);
  });

  it('переиспользование taskId: трек с voxTaskId → НЕТ submit, есть poll(тот же taskId)', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice', voxTaskId: 'saved-task-77' })],
    });
    await run(worker);

    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.poll).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledWith(
      'saved-task-77',
      expect.objectContaining({ intervalMs: 5000, maxAttempts: 180 }),
    );
  });

  it('протухший taskId: poll по сохранённому реджектит → очистка voxTaskId + свежий submit + poll', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice', voxTaskId: 'stale-task' })],
    });
    let firstPoll = true;
    (deps.poll as ReturnType<typeof vi.fn>).mockImplementation(async (taskId: string) => {
      if (taskId === 'stale-task' && firstPoll) {
        firstPoll = false;
        throw new Error('Vox poll 404: task not found');
      }
      return completedResult;
    });
    await run(worker);

    expect(deps.audioTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a' }, data: { voxTaskId: null } }),
    );
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledTimes(2);
    expect(deps.upsert).toHaveBeenCalledTimes(1);
    expect(deps.enqueueMerge).toHaveBeenCalledTimes(1);
  });

  it('#74: пустой результат + малое аудио (битое) → ОДИН ре-submit свежей задачи', async () => {
    const empty = {
      status: 'COMPLETED' as const,
      transcriptText: '',
      durationSeconds: 0,
      words: [] as Array<{ word: string; startMs: number; endMs: number }>,
    };
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
      pollImpl: async () => empty,
    });
    await run(worker);

    expect(deps.submit).toHaveBeenCalledTimes(2);
    expect(deps.poll).toHaveBeenCalledTimes(2);
  });

  it('#74: пустой результат, но аудио не малое и dur>0 (тишина) → БЕЗ ре-submit', async () => {
    const silent = {
      status: 'COMPLETED' as const,
      transcriptText: '',
      durationSeconds: 120,
      words: [] as Array<{ word: string; startMs: number; endMs: number }>,
    };
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
      pollImpl: async () => silent,
    });
    (deps.s3.getObject as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.alloc(5000));
    await run(worker);

    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledTimes(1);
  });

  it('merge ровно один раз только когда ВСЕ дорожки успешны', async () => {
    const { worker, deps } = makeWorker({
      tracks: [
        track({ id: 'a', livekitIdentity: 'host:alice' }),
        track({ id: 'b', livekitIdentity: 'guest:bob' }),
        track({ id: 'c', livekitIdentity: 'guest:carol' }),
      ],
    });
    await run(worker);
    expect(deps.enqueueMerge).toHaveBeenCalledTimes(1);
  });

  it('частичный ретрай: 2 из 3 дорожек уже в БД → submit/poll только для 3-й, доделывает остаток, merge один раз', async () => {
    const existingTrack = (name: string) => ({
      speakerName: name,
      transcriptText: 'ранее сохранённый текст',
      durationSeconds: 12,
      words: [
        { word: 'ранее', startMs: 0, endMs: 200 },
        { word: 'сохранено', startMs: 300, endMs: 700 },
      ],
    });
    const { worker, deps } = makeWorker({
      status: 'transcription_processing',
      tracks: [
        track({ id: 'a', livekitIdentity: 'host:alice' }),
        track({ id: 'b', livekitIdentity: 'guest:bob' }),
        track({ id: 'c', livekitIdentity: 'guest:carol' }),
      ],
      existingByIdentity: {
        'host:alice': existingTrack('Alice'),
        'guest:bob': existingTrack('Bob'),
      },
    });

    await run(worker);

    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.poll).toHaveBeenCalledTimes(1);
    expect(deps.upsert).toHaveBeenCalledTimes(1);
    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ livekitIdentity: 'guest:carol' }),
      }),
    );
    expect(deps.enqueueMerge).toHaveBeenCalledTimes(1);
    expect(deps.enqueueMerge).toHaveBeenCalledWith('m-1');
  });

  it('нет audio-треков → встреча уходит в терминальный `failed` (Фаза 11: показывать нечего)', async () => {
    const { worker, deps } = makeWorker({ tracks: [] });
    await run(worker);

    expect(deps.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'failed',
      expect.objectContaining({ failureReason: 'transcribe: no_audio_tracks' }),
    );
    expect(deps.meetings.transitionStatus).not.toHaveBeenCalledWith(
      'm-1',
      'ai_failed',
      expect.anything(),
    );
    expect(deps.metrics.incMeetingFailed).toHaveBeenCalledWith('transcribe');
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('Ф2 (ASR ТЗ 2026-06-11): персистит voxResult.segments в slim-форме (без speaker/speakerId)', async () => {
    const withSegments = {
      status: 'COMPLETED' as const,
      transcriptText: 'привет',
      durationSeconds: 5,
      words: [] as Array<{ word: string; startMs: number; endMs: number }>,
      segments: [{ startSec: 1, endSec: 2, text: 'а', speaker: 'SPEAKER 1', speakerId: 1 }],
    };
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
      pollImpl: async () => withSegments as unknown as typeof completedResult,
    });
    (deps.s3.getObject as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.alloc(5000));
    await run(worker);

    expect(deps.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          segments: [{ startSec: 1, endSec: 2, text: 'а' }],
        }),
      }),
    );
  });
});

describe('TranscribeWorker.onJobFailed (Фаза 11: развязка записи от AI-статуса)', () => {
  function failJob(): unknown {
    return { data: { meetingId: 'm-1' }, attemptsMade: 5, opts: { attempts: 5 } };
  }

  it('финальный сбой AI-ветки → встреча уходит в `ai_failed`, НЕ в `failed` (запись остаётся смотрибельной)', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
    });

    await (
      worker as unknown as { onJobFailed: (j: unknown, e: Error) => Promise<void> }
    ).onJobFailed(failJob(), new Error('Vox poll timeout'));

    expect(deps.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'ai_failed',
      expect.objectContaining({ failureReason: 'transcribe: Vox poll timeout' }),
    );
    expect(deps.meetings.transitionStatus).not.toHaveBeenCalledWith(
      'm-1',
      'failed',
      expect.anything(),
    );
    expect(deps.metrics.incMeetingFailed).toHaveBeenCalledWith('transcribe');
  });

  it('до исчерпания ретраев (attemptsMade < attempts) → не трогает статус', async () => {
    const { worker, deps } = makeWorker({
      tracks: [track({ id: 'a', livekitIdentity: 'host:alice' })],
    });

    await (
      worker as unknown as { onJobFailed: (j: unknown, e: Error) => Promise<void> }
    ).onJobFailed(
      { data: { meetingId: 'm-1' }, attemptsMade: 2, opts: { attempts: 5 } },
      new Error('transient'),
    );

    expect(deps.meetings.transitionStatus).not.toHaveBeenCalled();
  });
});

describe('LivekitEventsHandler.parseEgressStartedAt (E: ns→Date)', () => {
  it('started_at в наносекундах (number) → корректная Date', () => {
    const ns = 1_700_000_000_000_000_000;
    const d = LivekitEventsHandler.parseEgressStartedAt(ns);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(ns / 1_000_000);
  });

  it('started_at как строка наносекунд → корректная Date', () => {
    const d = LivekitEventsHandler.parseEgressStartedAt('1700000000000000000');
    expect(d?.getTime()).toBe(1_700_000_000_000);
  });

  it('started_at как bigint → корректная Date', () => {
    const d = LivekitEventsHandler.parseEgressStartedAt(1_700_000_000_000_000_000n);
    expect(d?.getTime()).toBe(1_700_000_000_000);
  });

  it('0 / undefined / мусор → null (без fallback)', () => {
    expect(LivekitEventsHandler.parseEgressStartedAt(0)).toBeNull();
    expect(LivekitEventsHandler.parseEgressStartedAt(undefined)).toBeNull();
    expect(LivekitEventsHandler.parseEgressStartedAt('abc')).toBeNull();
    expect(LivekitEventsHandler.parseEgressStartedAt(null)).toBeNull();
    expect(LivekitEventsHandler.parseEgressStartedAt('')).toBeNull();
  });

  it('нет ns, но есть createdAt в секундах → fallback на createdAt', () => {
    const d = LivekitEventsHandler.parseEgressStartedAt(undefined, 1_700_000_000);
    expect(d?.getTime()).toBe(1_700_000_000 * 1000);
  });

  it('ns присутствует → createdAt-fallback игнорируется', () => {
    const d = LivekitEventsHandler.parseEgressStartedAt(1_700_000_000_000_000_000, 1_600_000_000);
    expect(d?.getTime()).toBe(1_700_000_000_000);
  });
});
