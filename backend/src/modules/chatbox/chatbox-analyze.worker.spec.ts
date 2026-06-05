import { type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { ChatboxAnalyzeWorker } from './chatbox-analyze.worker';
import type { ChatboxIngestService } from './chatbox-ingest.service';
import type { ChatboxAnalyzeJobData } from './queue/chatbox-analyze.queue';

/**
 * Unit-тесты воркера анализа сессии ChatBox: Prisma / ChatboxIngestService
 * замоканы. Redis не нужен (worker создаётся в onModuleInit, который не
 * вызываем — тестируем чистый process()).
 */
describe('ChatboxAnalyzeWorker', () => {
  let prismaMock: {
    chatboxChatSession: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let ingestMock: {
    generateSummary: ReturnType<typeof vi.fn>;
    ingestSession: ReturnType<typeof vi.fn>;
  };
  let worker: ChatboxAnalyzeWorker;

  const job = {
    id: 'chatbox-analyze:s1',
    data: { tenantId: 't1', sessionId: 's1' } satisfies ChatboxAnalyzeJobData,
  } as unknown as Job<ChatboxAnalyzeJobData>;

  beforeEach(() => {
    prismaMock = {
      chatboxChatSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    ingestMock = {
      generateSummary: vi.fn(),
      ingestSession: vi.fn(),
    };

    worker = new ChatboxAnalyzeWorker(
      {} as unknown as RedisService,
      prismaMock as unknown as PrismaService,
      ingestMock as unknown as ChatboxIngestService,
    );
  });

  it('успешный путь: summary persist + done + rawEventId + analyzedAt', async () => {
    ingestMock.generateSummary.mockResolvedValue('s');
    ingestMock.ingestSession.mockResolvedValue({ rawEventId: 'r' });

    await worker.process(job);

    // analyzing
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { analysisStatus: 'analyzing' },
      }),
    );
    // summary persist
    expect(prismaMock.chatboxChatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: { summary: 's' },
      }),
    );
    // done + rawEventId + analyzedAt
    expect(prismaMock.chatboxChatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          analysisStatus: 'done',
          rawEventId: 'r',
          analyzedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('summary=null → summary НЕ пишется, но done выставляется', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockResolvedValue({ rawEventId: 'r' });

    await worker.process(job);

    expect(prismaMock.chatboxChatSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { summary: expect.anything() } }),
    );
    expect(prismaMock.chatboxChatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ analysisStatus: 'done' }),
      }),
    );
  });

  it('ingestSession=null (открытая) → НЕ помечает done, не падает', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockResolvedValue(null);

    await expect(worker.process(job)).resolves.toBeUndefined();

    // Только analyzing, никаких done/failed update.
    expect(prismaMock.chatboxChatSession.update).not.toHaveBeenCalled();
  });

  it('ingestSession бросает → analysisStatus=failed + rethrow', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockRejectedValue(new Error('boom'));

    await expect(worker.process(job)).rejects.toThrow('boom');

    expect(prismaMock.chatboxChatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: { analysisStatus: 'failed' },
      }),
    );
  });
});
