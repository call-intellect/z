import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService.listEpisodesByDateRange — перечень эпизодов за период', () => {
  let prismaStub: {
    sourceEpisode: { findMany: ReturnType<typeof vi.fn> };
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      sourceEpisode: { findMany: vi.fn() },
    };
    embeddingsStub = { embedQuery: vi.fn() };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  it('listEpisodesByDateRange → tenantId + occurredAt range в where, mapped shape', async () => {
    prismaStub.sourceEpisode.findMany.mockResolvedValue([
      {
        id: 'e1',
        title: 'Планёрка',
        occurredAt: new Date('2026-06-10'),
        kind: 'meeting',
        rawEventId: 'r1',
      },
    ]);

    const result = await svc.listEpisodesByDateRange({
      tenantId: 't',
      dateFrom: new Date('2026-06-08'),
      dateTo: new Date('2026-06-14'),
      limit: 30,
    });

    expect(result).toEqual([
      {
        id: 'e1',
        title: 'Планёрка',
        occurredAt: new Date('2026-06-10'),
        kind: 'meeting',
        rawEventId: 'r1',
      },
    ]);

    expect(prismaStub.sourceEpisode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't',
          occurredAt: { gte: expect.any(Date), lte: expect.any(Date) },
        }),
      }),
    );
  });

  it('limit<=0 → [] без запроса', async () => {
    const result = await svc.listEpisodesByDateRange({
      tenantId: 't',
      dateFrom: new Date(),
      dateTo: new Date(),
      limit: 0,
    });

    expect(result).toEqual([]);
    expect(prismaStub.sourceEpisode.findMany).not.toHaveBeenCalled();
  });
});
