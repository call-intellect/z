import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — deep-hop обход графа AGE (Cypher)', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
    entityLink: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let metricsStub: { incChatV2GraphCypherRecall: ReturnType<typeof vi.fn> };
  let graphStub: { getNeighbors: ReturnType<typeof vi.fn> };

  function makeSvc(withGraph: boolean): ChatV2RetrievalService {
    return new ChatV2RetrievalService(
      prismaStub as unknown as never,
      cfgStub as unknown as never,
      embeddingsStub as unknown as never,
      metricsStub as unknown as never,
      withGraph ? (graphStub as unknown as never) : undefined,
    );
  }

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
    metricsStub = { incChatV2GraphCypherRecall: vi.fn() };
    graphStub = { getNeighbors: vi.fn() };
  });

  it('graphCypherRecall=true + graphHops>=2 + entityIds → getNeighbors(entity) + блок b-graph в пуле', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    graphStub.getNeighbors.mockResolvedValue({
      nodes: [{ type: 'entity', id: 'e2' }],
      edges: [],
    });
    prismaStub.ideaBlockEntity.findMany.mockResolvedValueOnce([
      { blockId: 'b-graph', entityId: 'e2' },
    ]);

    const svc = makeSvc(true);
    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'сначала A потом что стало с B',
      limit: 10,
      graphHops: 2,
      entityIds: ['e1'],
      graphCypherRecall: true,
      graphCypherMaxDepth: 3,
    });

    expect(graphStub.getNeighbors).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't',
        node: expect.objectContaining({ type: 'entity', id: 'e1' }),
      }),
    );
    expect(prismaStub.ideaBlockEntity.findMany).toHaveBeenCalled();
    const ids = result.map((r) => r.blockId);
    expect(ids).toContain('b-graph');
    expect(
      result.find((r) => r.blockId === 'b-graph')?.fromGraph,
    ).toBe(true);
    expect(metricsStub.incChatV2GraphCypherRecall).toHaveBeenCalled();
  });

  it('graphCypherRecall=false → getNeighbors НЕ вызван, пул реляционный', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);

    const svc = makeSvc(true);
    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 2,
      entityIds: ['e1'],
      graphCypherRecall: false,
      graphCypherMaxDepth: 3,
    });

    expect(graphStub.getNeighbors).not.toHaveBeenCalled();
    expect(result.map((r) => r.blockId)).not.toContain('b-graph');
  });

  it('graphHops<2 → getNeighbors НЕ вызван', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);

    const svc = makeSvc(true);
    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 1,
      entityIds: ['e1'],
      graphCypherRecall: true,
      graphCypherMaxDepth: 3,
    });

    expect(graphStub.getNeighbors).not.toHaveBeenCalled();
  });

  it('entityIds пуст → getNeighbors НЕ вызван', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);

    const svc = makeSvc(true);
    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 2,
      entityIds: [],
      graphCypherRecall: true,
      graphCypherMaxDepth: 3,
    });

    expect(graphStub.getNeighbors).not.toHaveBeenCalled();
  });

  it('fail-open: getNeighbors бросает → пул реляционный, ответ не падает', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    graphStub.getNeighbors.mockRejectedValue(new Error('AGE недоступен'));

    const svc = makeSvc(true);
    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 2,
      entityIds: ['e1'],
      graphCypherRecall: true,
      graphCypherMaxDepth: 3,
    });

    expect(graphStub.getNeighbors).toHaveBeenCalled();
    expect(result.map((r) => r.blockId)).toContain('b1');
    expect(metricsStub.incChatV2GraphCypherRecall).not.toHaveBeenCalled();
  });

  it('graph не инжектнут (undefined) → без краша, пул реляционный', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);

    const svc = makeSvc(false);
    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 2,
      entityIds: ['e1'],
      graphCypherRecall: true,
      graphCypherMaxDepth: 3,
    });

    expect(result.map((r) => r.blockId)).toContain('b1');
    expect(prismaStub.ideaBlockEntity.findMany).not.toHaveBeenCalled();
  });
});
