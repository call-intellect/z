import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../../recordings/s3.service';
import type { TranscriptCleanLlmRefineService } from '../services/transcript-clean-llm-refine.service';

import { TranscriptCleanWorker } from './transcript-clean.worker';

describe('TranscriptCleanWorker.process (integration)', () => {
  const meetingId = 'm-test-1';
  const mergedKey = `meetings/${meetingId}/transcripts/merged.json`;
  const transcriptId = 'tr-1';

  function makeMocks(opts: { llmRefineEnabled: boolean; llmRefineSkipped: boolean }) {
    const merged = {
      turns: [
        {
          speaker: 'host:alice',
          text: 'Эээ, я думаю, нам надо переделать сайт.',
          startSec: 1,
          endSec: 8.5,
        },
        { speaker: 'guest:bob', text: 'Ага.', startSec: 9, endSec: 9.3 },
        {
          speaker: 'host:alice',
          text: 'Я я я уверен, что это критически важно.',
          startSec: 10,
          endSec: 15,
        },
      ],
    };

    const transcriptUpdate = vi.fn(async (params: { data: Record<string, unknown> }) => ({
      id: transcriptId,
      ...params.data,
    }));
    const findUnique = vi.fn(async () => ({
      id: meetingId,
      type: 'sales',
      tenantId: 'org-1',
      transcript: {
        id: transcriptId,
        meetingId,
        mergedS3Url: mergedKey,
        cleanedS3Url: null,
        cleaningStatus: null,
      },
    }));

    const s3Get = vi.fn(async (_key: string) => merged);
    const s3Put = vi.fn(async (_key: string, _data: unknown) => undefined);

    const refine = vi.fn(async () => ({
      segments: [],
      refined: 0,
      llmRefineSkipped: opts.llmRefineSkipped,
    }));

    const incTranscriptCleaningCompleted = vi.fn();
    const observeTranscriptCleaningDuration = vi.fn();
    const observeTranscriptCleaningCharsReduced = vi.fn();

    const prisma = {
      meeting: { findUnique },
      transcript: { update: transcriptUpdate, updateMany: vi.fn() },
    } as unknown as PrismaService;

    const s3 = {
      getJson: s3Get,
      putJson: s3Put,
    } as unknown as S3Service;

    const cfg = {
      aiFeatures: {
        transcriptCleaningLlmRefine: opts.llmRefineEnabled,
        includeRoomChat: true,
      },
    } as unknown as TypedConfigService;

    const metrics = {
      incTranscriptCleaningCompleted,
      incTranscriptCleaningFailed: vi.fn(),
      observeTranscriptCleaningDuration,
      observeTranscriptCleaningCharsReduced,
      addTranscriptCleaningLlmCostUsd: vi.fn(),
    } as unknown as BusinessMetricsService;

    const llmRefine = {
      refine: vi.fn(async (params: { segments: unknown[] }) => ({
        segments: params.segments,
        refined: 0,
        llmRefineSkipped: opts.llmRefineSkipped,
      })),
    } as unknown as TranscriptCleanLlmRefineService;

    return {
      prisma,
      s3,
      cfg,
      metrics,
      llmRefine,
      mocks: { findUnique, transcriptUpdate, s3Get, s3Put, refine, incTranscriptCleaningCompleted },
    };
  }

  it('happy path: пишет cleaned.json в S3, обновляет Transcript, сохраняет mapping originalIndex', async () => {
    const m = makeMocks({ llmRefineEnabled: false, llmRefineSkipped: false });

    const worker = new TranscriptCleanWorker(
      {} as RedisService,
      m.prisma,
      m.s3,
      m.metrics,
      m.cfg,
      m.llmRefine,
    );

    const job = {
      id: 'job-1',
      data: { meetingId, attempt: 1 },
      attemptsMade: 0,
      opts: { attempts: 5 },
    };
    await worker.process(job as unknown as Parameters<typeof worker.process>[0]);

    expect(m.mocks.s3Put).toHaveBeenCalledTimes(1);
    const [putKey, putContent] = m.mocks.s3Put.mock.calls[0]!;
    expect(putKey).toBe(`meetings/${meetingId}/transcripts/cleaned.json`);
    const cleaned = putContent as {
      version: number;
      originalUrl: string;
      segments: Array<{
        originalIndex: number;
        startMs: number;
        cleanedText: string;
        originalText: string;
        removed: Array<{ type: string; text: string }>;
      }>;
      stats: { charsBefore: number; charsAfter: number; llmRefineSkipped?: boolean };
    };
    expect(cleaned.version).toBe(1);
    expect(cleaned.originalUrl).toBe(mergedKey);
    expect(cleaned.segments).toHaveLength(3);
    expect(cleaned.segments.map((s) => s.originalIndex)).toEqual([0, 1, 2]);
    expect(cleaned.segments[0]!.startMs).toBe(1000);
    expect(cleaned.segments[1]!.startMs).toBe(9000);
    expect(cleaned.segments[2]!.startMs).toBe(10000);
    expect(cleaned.segments[0]!.cleanedText.toLowerCase()).not.toContain('эээ');
    expect(cleaned.segments[1]!.cleanedText).toBe('');
    expect(cleaned.segments[2]!.cleanedText).toMatch(/^Я уверен/);
    expect(cleaned.stats.charsAfter).toBeLessThan(cleaned.stats.charsBefore);

    expect(m.mocks.transcriptUpdate).toHaveBeenCalledTimes(2);
    const lastUpdate = m.mocks.transcriptUpdate.mock.calls[1]![0] as {
      data: {
        cleanedS3Url: string;
        cleaningStatus: string;
        cleaningStats: object;
        cleanedAt: Date;
      };
    };
    expect(lastUpdate.data.cleanedS3Url).toBe(`meetings/${meetingId}/transcripts/cleaned.json`);
    expect(lastUpdate.data.cleaningStatus).toBe('ready');
    expect(lastUpdate.data.cleanedAt).toBeInstanceOf(Date);

    expect(m.mocks.incTranscriptCleaningCompleted).toHaveBeenCalledTimes(1);
  });

  it('llmRefine выключен по флагу → llmRefineSkipped=true в stats', async () => {
    const m = makeMocks({ llmRefineEnabled: false, llmRefineSkipped: false });

    const worker = new TranscriptCleanWorker(
      {} as RedisService,
      m.prisma,
      m.s3,
      m.metrics,
      m.cfg,
      m.llmRefine,
    );

    await worker.process({
      id: 'job-1',
      data: { meetingId, attempt: 1 },
      attemptsMade: 0,
      opts: { attempts: 5 },
    } as unknown as Parameters<typeof worker.process>[0]);

    expect(
      (m.llmRefine.refine as unknown as { mock: { calls: unknown[][] } }).mock.calls.length,
    ).toBe(0);
    const cleaned = m.mocks.s3Put.mock.calls[0]![1] as { stats: { llmRefineSkipped: boolean } };
    expect(cleaned.stats.llmRefineSkipped).toBe(true);
  });

  it('полный отказ LLM-refine — воркер успешно завершается через уровень 1', async () => {
    const m = makeMocks({ llmRefineEnabled: true, llmRefineSkipped: true });

    const worker = new TranscriptCleanWorker(
      {} as RedisService,
      m.prisma,
      m.s3,
      m.metrics,
      m.cfg,
      m.llmRefine,
    );

    await worker.process({
      id: 'job-1',
      data: { meetingId, attempt: 1 },
      attemptsMade: 0,
      opts: { attempts: 5 },
    } as unknown as Parameters<typeof worker.process>[0]);

    expect(
      (m.llmRefine.refine as unknown as { mock: { calls: unknown[][] } }).mock.calls.length,
    ).toBe(1);
    expect(m.mocks.incTranscriptCleaningCompleted).toHaveBeenCalledTimes(1);
    expect(m.mocks.s3Put).toHaveBeenCalledTimes(1);
    const cleaned = m.mocks.s3Put.mock.calls[0]![1] as { stats: { llmRefineSkipped: boolean } };
    expect(cleaned.stats.llmRefineSkipped).toBe(true);
    const lastUpdate = m.mocks.transcriptUpdate.mock.calls[1]![0] as {
      data: { cleaningStatus: string };
    };
    expect(lastUpdate.data.cleaningStatus).toBe('ready');
  });

  it('idempotency: если уже ready — выходит без работы', async () => {
    const findUnique = vi.fn(async () => ({
      id: meetingId,
      type: 'sales',
      tenantId: 'org-1',
      transcript: {
        id: transcriptId,
        meetingId,
        mergedS3Url: mergedKey,
        cleanedS3Url: `meetings/${meetingId}/transcripts/cleaned.json`,
        cleaningStatus: 'ready',
      },
    }));
    const prisma = {
      meeting: { findUnique },
      transcript: { update: vi.fn(), updateMany: vi.fn() },
    } as unknown as PrismaService;
    const s3Put = vi.fn();
    const s3 = {
      getJson: vi.fn(),
      putJson: s3Put,
    } as unknown as S3Service;
    const incCompleted = vi.fn();
    const metrics = {
      incTranscriptCleaningCompleted: incCompleted,
      incTranscriptCleaningFailed: vi.fn(),
      observeTranscriptCleaningDuration: vi.fn(),
      observeTranscriptCleaningCharsReduced: vi.fn(),
      addTranscriptCleaningLlmCostUsd: vi.fn(),
    } as unknown as BusinessMetricsService;

    const worker = new TranscriptCleanWorker(
      {} as RedisService,
      prisma,
      s3,
      metrics,
      {
        aiFeatures: { transcriptCleaningLlmRefine: true, includeRoomChat: true },
      } as unknown as TypedConfigService,
      { refine: vi.fn() } as unknown as TranscriptCleanLlmRefineService,
    );

    await worker.process({
      id: 'job-1',
      data: { meetingId, attempt: 1 },
      attemptsMade: 0,
      opts: { attempts: 5 },
    } as unknown as Parameters<typeof worker.process>[0]);

    expect(s3Put).not.toHaveBeenCalled();
    expect(incCompleted).not.toHaveBeenCalled();
  });
});
