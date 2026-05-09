import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { AiQueueService } from '../ai-queue.service';

import { RetryService } from './retry.service';

interface Mocks {
  prisma: PrismaService;
  redis: RedisService;
  queue: AiQueueService;
  meetings: MeetingsService;
  enqueueTranscribe: ReturnType<typeof vi.fn>;
  enqueueMerge: ReturnType<typeof vi.fn>;
  enqueueAnalyze: ReturnType<typeof vi.fn>;
  meetingUpdate: ReturnType<typeof vi.fn>;
  meetingEventCreate: ReturnType<typeof vi.fn>;
  setMeeting: (m: {
    id: string;
    status: string;
    transcript: { rawIndexS3Url: string | null; mergedS3Url: string | null } | null;
    aiResult: { id: string } | null;
  } | null) => void;
}

function makeMocks(): Mocks {
  let currentMeeting:
    | {
        id: string;
        status: string;
        transcript: { rawIndexS3Url: string | null; mergedS3Url: string | null } | null;
        aiResult: { id: string } | null;
      }
    | null = null;

  const findUnique = vi.fn(async () => currentMeeting);
  const meetingUpdate = vi.fn(async () => undefined);
  const meetingEventCreate = vi.fn(async () => undefined);
  const $transaction = vi.fn(async (ops: unknown[]) => {
    // Просто прогоняем в Promise.all для имитации.
    return Promise.all(ops as Promise<unknown>[]);
  });

  const prisma = {
    meeting: { findUnique, update: vi.fn(() => meetingUpdate()) },
    meetingEvent: { create: vi.fn(() => meetingEventCreate()) },
    $transaction,
  } as unknown as PrismaService;

  const incr = vi.fn(async () => 1);
  const expire = vi.fn(async () => 1);
  const redis = {
    client: { incr, expire },
  } as unknown as RedisService;

  const enqueueTranscribe = vi.fn(async () => undefined);
  const enqueueMerge = vi.fn(async () => undefined);
  const enqueueAnalyze = vi.fn(async () => undefined);
  const queue = {
    enqueueTranscribe,
    enqueueMerge,
    enqueueAnalyze,
    enqueueNotify: vi.fn(),
  } as unknown as AiQueueService;

  const meetings = {} as unknown as MeetingsService;

  return {
    prisma,
    redis,
    queue,
    meetings,
    enqueueTranscribe,
    enqueueMerge,
    enqueueAnalyze,
    meetingUpdate,
    meetingEventCreate,
    setMeeting: (m) => {
      currentMeeting = m;
    },
  };
}

describe('RetryService.retry', () => {
  let mocks: Mocks;
  let svc: RetryService;

  beforeEach(() => {
    mocks = makeMocks();
    svc = new RetryService(mocks.prisma, mocks.redis, mocks.queue, mocks.meetings);
  });

  it('failed без Transcript → enqueueTranscribe (stage=transcribe)', async () => {
    mocks.setMeeting({
      id: 'm-1',
      status: 'failed',
      transcript: null,
      aiResult: null,
    });
    const result = await svc.retry('m-1', 'user', 'u-1');
    expect(result.stage).toBe('transcribe');
    expect(mocks.enqueueTranscribe).toHaveBeenCalledOnce();
  });

  it('failed с rawIndex без merged → enqueueMerge (stage=merge)', async () => {
    mocks.setMeeting({
      id: 'm-2',
      status: 'failed',
      transcript: { rawIndexS3Url: 'k1', mergedS3Url: null },
      aiResult: null,
    });
    const result = await svc.retry('m-2', 'user', 'u-1');
    expect(result.stage).toBe('merge');
    expect(mocks.enqueueMerge).toHaveBeenCalledOnce();
  });

  it('failed с merged без AiResult → enqueueAnalyze (stage=analyze)', async () => {
    mocks.setMeeting({
      id: 'm-3',
      status: 'failed',
      transcript: { rawIndexS3Url: 'k1', mergedS3Url: 'k2' },
      aiResult: null,
    });
    const result = await svc.retry('m-3', 'user', 'u-1');
    expect(result.stage).toBe('analyze');
    expect(mocks.enqueueAnalyze).toHaveBeenCalledOnce();
  });

  it('всё готово → ошибка nothing_to_retry', async () => {
    mocks.setMeeting({
      id: 'm-4',
      status: 'failed',
      transcript: { rawIndexS3Url: 'k1', mergedS3Url: 'k2' },
      aiResult: { id: 'a-1' },
    });
    await expect(svc.retry('m-4', 'user', 'u-1')).rejects.toThrow();
  });

  it('user не из failed → ошибка', async () => {
    mocks.setMeeting({
      id: 'm-5',
      status: 'ai_processing',
      transcript: null,
      aiResult: null,
    });
    await expect(svc.retry('m-5', 'user', 'u-1')).rejects.toThrow();
  });

  it('rate-limit: 4-я попытка → QuotaExceededError', async () => {
    mocks.setMeeting({
      id: 'm-6',
      status: 'failed',
      transcript: null,
      aiResult: null,
    });
    const incr = vi.fn();
    incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    (mocks.redis.client as unknown as { incr: typeof incr }).incr = incr;
    await svc.retry('m-6', 'user', 'u-1');
    await svc.retry('m-6', 'user', 'u-1');
    await svc.retry('m-6', 'user', 'u-1');
    await expect(svc.retry('m-6', 'user', 'u-1')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });
});
