import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../../recordings/s3.service';
import type { TranscriptCleanLlmRefineService } from '../services/transcript-clean-llm-refine.service';

import { TranscriptCleanWorker } from './transcript-clean.worker';

describe('TranscriptCleanWorker: regression — cleaning не разрушает оригинал', () => {
  it('читает merged.json, пишет cleaned.json по отдельному ключу, оригинал не трогает', async () => {
    const meetingId = 'm-reg-1';
    const mergedKey = `meetings/${meetingId}/transcripts/merged.json`;
    const cleanedKey = `meetings/${meetingId}/transcripts/cleaned.json`;

    const merged = {
      turns: [
        {
          speaker: 'host:alice',
          text: 'Я думаю, нам надо переделать сайт.',
          startSec: 1,
          endSec: 4,
        },
      ],
    };

    const s3Get = vi.fn(async (key: string) => {
      expect(key).toBe(mergedKey);
      return merged;
    });
    const s3Put = vi.fn(async (key: string) => {
      expect(key).toBe(cleanedKey);
      expect(key).not.toBe(mergedKey);
    });

    const prisma = {
      meeting: {
        findUnique: vi.fn(async () => ({
          id: meetingId,
          type: 'sales',
          tenantId: 'org-1',
          transcript: {
            id: 'tr-1',
            meetingId,
            mergedS3Url: mergedKey,
            cleanedS3Url: null,
            cleaningStatus: null,
          },
        })),
      },
      transcript: {
        update: vi.fn(async (params: { data: Record<string, unknown> }) => ({
          id: 'tr-1',
          ...params.data,
        })),
        updateMany: vi.fn(),
      },
    } as unknown as PrismaService;

    const s3 = { getJson: s3Get, putJson: s3Put } as unknown as S3Service;
    const cfg = {
      aiFeatures: { transcriptCleaningLlmRefine: false, includeRoomChat: true },
    } as unknown as TypedConfigService;
    const metrics = {
      incTranscriptCleaningCompleted: vi.fn(),
      incTranscriptCleaningFailed: vi.fn(),
      observeTranscriptCleaningDuration: vi.fn(),
      observeTranscriptCleaningCharsReduced: vi.fn(),
      addTranscriptCleaningLlmCostUsd: vi.fn(),
    } as unknown as BusinessMetricsService;
    const llmRefine = {
      refine: vi.fn(),
    } as unknown as TranscriptCleanLlmRefineService;

    const worker = new TranscriptCleanWorker(
      {} as RedisService,
      prisma,
      s3,
      metrics,
      cfg,
      llmRefine,
    );

    await worker.process({
      id: 'job-1',
      data: { meetingId, attempt: 1 },
      attemptsMade: 0,
      opts: { attempts: 5 },
    } as unknown as Parameters<typeof worker.process>[0]);

    expect(s3Get).toHaveBeenCalledWith(mergedKey);
    expect(s3Put).toHaveBeenCalledTimes(1);
    expect(s3Put.mock.calls[0]![0]).toBe(cleanedKey);
    for (const call of s3Put.mock.calls) {
      expect(call[0]).not.toBe(mergedKey);
    }
  });
});
