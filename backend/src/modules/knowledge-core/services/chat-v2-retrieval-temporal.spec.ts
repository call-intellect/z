import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — temporal validAt', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn() },
    };
    embeddingsStub = { embedQuery: vi.fn().mockRejectedValue(new Error('no')) };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  it('validAt задан — отфильтровывает блоки из «будущего»', async () => {
    const validAt = new Date('2025-01-01T00:00:00Z');
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }])
      .mockResolvedValueOnce([{ id: 'b1' }])
      .mockResolvedValueOnce([{ id: 'b1', updatedAt: new Date('2024-12-15') }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
      validAt,
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);

    const filterCall = prismaStub.ideaBlock.findMany.mock.calls[1]?.[0];
    expect(filterCall?.where?.createdAt).toEqual({ lte: validAt });
  });

  it('validAt не задан — фильтр НЕ применяется (no createdAt clause в pool-фильтре)', async () => {
    prismaStub.ideaBlock.findMany
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }])
      .mockResolvedValueOnce([
        { id: 'b1', updatedAt: new Date() },
        { id: 'b2', updatedAt: new Date() },
      ]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
    });

    expect(result.length).toBe(2);
    expect(prismaStub.ideaBlock.findMany).toHaveBeenCalledTimes(2);
  });
});
