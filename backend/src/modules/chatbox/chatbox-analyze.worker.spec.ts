import { type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';

import { ChatboxAnalyzeWorker } from './chatbox-analyze.worker';
import type { ChatboxIngestService } from './chatbox-ingest.service';
import type { ChatboxAnalyzeJobData } from './queue/chatbox-analyze.queue';

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

    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { analysisStatus: 'analyzing' },
      }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { summary: 's' },
      }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
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

    expect(prismaMock.chatboxChatSession.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { summary: expect.anything() } }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ analysisStatus: 'done' }),
      }),
    );
  });

  it('ingestSession=null (открытая) → НЕ помечает done, не падает', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockResolvedValue(null);

    await expect(worker.process(job)).resolves.toBeUndefined();

    expect(prismaMock.chatboxChatSession.update).not.toHaveBeenCalled();
  });

  it('ingestSession бросает → analysisStatus=failed + rethrow', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockRejectedValue(new Error('boom'));

    await expect(worker.process(job)).rejects.toThrow('boom');

    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { analysisStatus: 'failed' },
      }),
    );
  });
});
