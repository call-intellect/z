import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — graphAlwaysExpand (граф при структурном фильтре)', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockLink: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn(),
    };
    embeddingsStub = { embedQuery: vi.fn() };
    cfgStub = { knowledgeCore: { chatV2TopBlocks: 10 } };
    svc = new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
    );
  });

  it('структурный фильтр + graphAlwaysExpand=true → expandViaGraph выполняется (ideaBlockLink.findMany вызван)', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 1,
      entityIds: ['e429'],
      graphAlwaysExpand: true,
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);
    expect(prismaStub.ideaBlockLink.findMany).toHaveBeenCalled();
  });

  it('структурный фильтр + graphAlwaysExpand=false → expandViaGraph ПРОПУЩЕН (старое поведение)', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 1,
      entityIds: ['e429'],
      graphAlwaysExpand: false,
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);
    expect(prismaStub.ideaBlockLink.findMany).not.toHaveBeenCalled();
  });
});
