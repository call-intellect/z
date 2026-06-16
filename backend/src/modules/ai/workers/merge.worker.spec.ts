import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';
import type { AiQueueService } from '../ai-queue.service';

import { MergeWorker } from './merge.worker';

interface Mocks {
  prisma: PrismaService;
  meetings: MeetingsService;
  queue: AiQueueService;
  metrics: BusinessMetricsService;
  redis: RedisService;
  s3: S3Service;
  enqueueAnalyze: ReturnType<typeof vi.fn>;
  enqueueBehaviorMetrics: ReturnType<typeof vi.fn>;
  enqueueTranscriptClean: ReturnType<typeof vi.fn>;
}

function buildBaseMocks(opts: { meetingId: string }): Mocks {
  const meetingFindUnique = vi.fn(async () => ({
    id: opts.meetingId,
    type: 'sales',
    status: 'transcription_processing',
    tenantId: 'org-1',
    transcript: {
      turns: [{ speaker: 'Alice', text: 'hi', startSec: 0, endSec: 1 }],
      tracks: [{ id: 'trk-1' }],
    },
  }));

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    transcript: { update: vi.fn(async () => undefined) },
    org: { findUnique: vi.fn(async () => ({ transcriptCleaningAuto: false })) },
  } as unknown as PrismaService;

  const meetings = {
    transitionStatus: vi.fn(async () => undefined),
  } as unknown as MeetingsService;

  const enqueueAnalyze = vi.fn(async () => undefined);
  const enqueueBehaviorMetrics = vi.fn(async () => undefined);
  const enqueueTranscriptClean = vi.fn(async () => undefined);
  const queue = {
    enqueueAnalyze,
    enqueueBehaviorMetrics,
    enqueueTranscriptClean,
  } as unknown as AiQueueService;

  const metrics = {
    observeAiPipelineDuration: vi.fn(),
    incMeetingFailed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const redis = { client: {} } as unknown as RedisService;

  const s3 = {
    putJson: vi.fn(async () => undefined),
  } as unknown as S3Service;

  return {
    prisma,
    meetings,
    queue,
    metrics,
    redis,
    s3,
    enqueueAnalyze,
    enqueueBehaviorMetrics,
    enqueueTranscriptClean,
  };
}

function buildCfg(opts: {
  meetingReportFastEnabled: boolean;
  includeRoomChatInAi?: boolean;
}): TypedConfigService {
  return {
    ai: { vox: { model: 'v3_rnnt' } },
    aiFeatures: { includeRoomChat: opts.includeRoomChatInAi === true },
    s3: { bucket: 'bucket' },
    knowledgeCore: {
      meetingReportFastEnabled: opts.meetingReportFastEnabled,
    },
  } as unknown as TypedConfigService;
}

describe('MergeWorker.process — producer meeting-report-fast (ТЗ 2026-05-25, Фаза 4)', () => {
  it('идемпотентный путь: turns уже в БД, флаг=true — enqueueMeetingReportFast вызывается параллельно с analyze', async () => {
    const meetingId = 'm-fast-2';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    const enqueueMeetingReportFast = vi.fn(async () => undefined);
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      m.s3,
      coreQueue,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId, attempt: 1 },
      id: 'job-2',
    });

    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
    expect(enqueueMeetingReportFast).toHaveBeenCalledWith(meetingId);
  });

  it('kill-switch: при флаге=false — enqueueMeetingReportFast НЕ вызывается, legacy enqueue работают', async () => {
    const meetingId = 'm-fast-3';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: false });

    const enqueueMeetingReportFast = vi.fn(async () => undefined);
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      m.s3,
      coreQueue,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId, attempt: 1 },
      id: 'job-3',
    });

    expect(enqueueMeetingReportFast).not.toHaveBeenCalled();
    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
    expect(m.enqueueBehaviorMetrics).toHaveBeenCalledWith(meetingId);
  });

  it('coreQueue undefined (optional DI): producer тихо пропускается, merge не падает', async () => {
    const meetingId = 'm-fast-4';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    const worker = new MergeWorker(m.redis, m.prisma, m.queue, m.meetings, m.metrics, cfg, m.s3);

    await expect(
      (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
        data: { meetingId, attempt: 1 },
        id: 'job-4',
      }),
    ).resolves.toBeUndefined();

    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
  });

  it('failure isolation: enqueueMeetingReportFast бросает — merge продолжается (legacy цепочка не страдает)', async () => {
    const meetingId = 'm-fast-5';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    const enqueueMeetingReportFast = vi.fn(async () => {
      throw new Error('redis is gone');
    });
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      m.s3,
      coreQueue,
    );

    await expect(
      (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
        data: { meetingId, attempt: 1 },
        id: 'job-5',
      }),
    ).resolves.toBeUndefined();

    expect(enqueueMeetingReportFast).toHaveBeenCalledWith(meetingId);
    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
  });
});

describe('MergeWorker.onJobFailed (Фаза 11: развязка записи от AI-статуса)', () => {
  it('финальный сбой merge → встреча уходит в `ai_failed`, НЕ в `failed`', async () => {
    const meetingId = 'm-fail-1';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: false });
    const coreQueue = { enqueueMeetingReportFast: vi.fn() } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      m.s3,
      coreQueue,
    );

    await (
      worker as unknown as { onJobFailed: (j: unknown, e: Error) => Promise<void> }
    ).onJobFailed(
      { data: { meetingId }, attemptsMade: 5, opts: { attempts: 5 } },
      new Error('merge boom'),
    );

    const transitionStatus = m.meetings.transitionStatus as ReturnType<typeof vi.fn>;
    expect(transitionStatus).toHaveBeenCalledWith(
      meetingId,
      'ai_failed',
      expect.objectContaining({ failureReason: 'merge: merge boom' }),
    );
    expect(transitionStatus).not.toHaveBeenCalledWith(meetingId, 'failed', expect.anything());
    expect(m.metrics.incMeetingFailed).toHaveBeenCalledWith('merge');
  });
});

describe('MergeWorker.process — посегментная переплётка (ASR ТЗ 2026-06-11, Ф3)', () => {
  function runWithTracks(
    tracks: Array<{
      speakerName: string;
      words?: unknown[];
      segments?: unknown[];
      transcriptText?: string;
      durationSeconds?: number;
      offsetMs?: number;
    }>,
  ): {
    worker: MergeWorker;
    getTurns: () => Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    getDuration: () => number;
  } {
    const base = new Date('2026-06-11T10:00:00.000Z');
    let capturedTurns: Array<{ speaker: string; text: string; startSec: number; endSec: number }> =
      [];
    let capturedDuration = 0;

    const meetingFindUnique = vi.fn(async () => ({
      id: 'm-seg',
      type: 'sales',
      status: 'transcription_ready',
      tenantId: 'org-1',
      transcript: {
        turns: null,
        mergedS3Url: 's3://x/merged.json',
        tracks: tracks.map((t, i) => ({
          words: t.words ?? [],
          segments: t.segments ?? [],
          transcriptText: t.transcriptText ?? '',
          durationSeconds: t.durationSeconds ?? 0,
          speakerName: t.speakerName,
          trackStartedAt: new Date(base.getTime() + (t.offsetMs ?? 0)),
          baseStartedAt: base,
          participantId: `p-${i}`,
          livekitIdentity: `id-${i}`,
        })),
      },
    }));
    const transcriptUpdate = vi.fn(
      async (arg: { data: { turns: unknown; totalDurationSeconds: number } }) => {
        capturedTurns = arg.data.turns as typeof capturedTurns;
        capturedDuration = arg.data.totalDurationSeconds;
        return undefined;
      },
    );
    const prisma = {
      meeting: { findUnique: meetingFindUnique },
      transcript: { update: transcriptUpdate },
      org: { findUnique: vi.fn(async () => ({ transcriptCleaningAuto: false })) },
    } as unknown as PrismaService;

    const m = buildBaseMocks({ meetingId: 'm-seg' });
    const cfg = buildCfg({ meetingReportFastEnabled: false });
    const coreQueue = {
      enqueueMeetingReportFast: vi.fn(async () => undefined),
    } as unknown as CoreQueueService;
    const worker = new MergeWorker(
      m.redis,
      prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      m.s3,
      coreQueue,
    );

    return { worker, getTurns: () => capturedTurns, getDuration: () => capturedDuration };
  }

  async function process(worker: MergeWorker, id: string): Promise<void> {
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId: 'm-seg', attempt: 1 },
      id,
    });
  }

  it('R3: words пустые, segments → переплётка по времени A→B→A; totalDuration=15 (не сумма дорожек)', async () => {
    const { worker, getTurns, getDuration } = runWithTracks([
      {
        speakerName: 'Alice',
        segments: [
          { startSec: 0, endSec: 5, text: 'A1' },
          { startSec: 10, endSec: 15, text: 'A2' },
        ],
      },
      { speakerName: 'Bob', segments: [{ startSec: 6, endSec: 9, text: 'B1' }] },
    ]);
    await process(worker, 'job-seg-1');
    const turns = getTurns();
    expect(turns.map((t) => t.speaker)).toEqual(['Alice', 'Bob', 'Alice']);
    expect(turns.map((t) => t.text)).toEqual(['A1', 'B1', 'A2']);
    expect(getDuration()).toBe(15);
  });

  it('R5: вырожденные сегменты (endSec<=startSec / пустой текст) исключены', async () => {
    const { worker, getTurns } = runWithTracks([
      {
        speakerName: 'Alice',
        segments: [
          { startSec: 0, endSec: 5, text: 'A1' },
          { startSec: 1, endSec: 1, text: 'bad' },
          { startSec: 0, endSec: 1, text: '   ' },
        ],
      },
    ]);
    await process(worker, 'job-seg-2');
    const turns = getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('A1');
  });

  it('R4: ни words, ни segments — резерв «1 псевдо-слово на дорожку» (transcriptText, поведение сохранено)', async () => {
    const { worker, getTurns } = runWithTracks([
      { speakerName: 'Alice', transcriptText: 'привет', durationSeconds: 12 },
    ]);
    await process(worker, 'job-seg-3');
    const turns = getTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('привет');
  });
});
