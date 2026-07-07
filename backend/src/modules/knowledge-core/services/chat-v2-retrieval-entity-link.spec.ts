import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — обход по EntityLink (вещь↔вещь)', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
    entityLink: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockLink: { findMany: vi.fn().mockResolvedValue([]) },
      entityLink: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    embeddingsStub = { embedQuery: vi.fn() };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  it('entityLinkHops=1 + entityIds → EntityLink.findMany с tenantId, связанные блоки в пуле', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);
    prismaStub.entityLink.findMany.mockResolvedValueOnce([
      {
        fromEntityId: 'e429',
        toEntityId: 'eBitrix',
        fromType: null,
        toType: null,
        confidence: 0.9,
      },
    ]);
    prismaStub.ideaBlockEntity.findMany.mockResolvedValueOnce([
      { blockId: 'bBitrix', entityId: 'eBitrix' },
    ]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 0,
      entityIds: ['e429'],
      entityLinkHops: 1,
    });

    expect(prismaStub.entityLink.findMany).toHaveBeenCalled();
    expect(prismaStub.entityLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't', status: 'active' }),
      }),
    );
    expect(prismaStub.ideaBlockEntity.findMany).toHaveBeenCalled();
    expect(result.map((r) => r.blockId)).toContain('bBitrix');
  });

  it('entityLinkHops=0 → EntityLink.findMany НЕ вызван', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 0,
      entityIds: ['e429'],
      entityLinkHops: 0,
    });

    expect(prismaStub.entityLink.findMany).not.toHaveBeenCalled();
  });

  it('entityLinkHops=1, но entityIds пуст → EntityLink.findMany НЕ вызван', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'какой бюджет на маркетинг',
      limit: 10,
      graphHops: 0,
      entityLinkHops: 1,
    });

    expect(prismaStub.entityLink.findMany).not.toHaveBeenCalled();
  });
});
