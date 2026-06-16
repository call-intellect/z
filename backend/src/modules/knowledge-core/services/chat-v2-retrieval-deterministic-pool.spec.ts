/**
 * Волна 3 — Б26 [K3] unit-тест детерминированного pool'а ChatV2RetrievalService.
 *
 * До фикса: pool-запросы (`take 5000` org, `take 1000` join-scope) шли без
 * orderBy → Postgres отдавал произвольное подмножество, ответы chat-v2
 * нестабильны между прогонами. Фикс:
 *  - org + qvec (без структурного фильтра) → pgvector HNSW
 *    `ORDER BY embedding <=> qvec LIMIT 5000` (детерминированный recall);
 *  - org без qvec → `orderBy updatedAt desc`;
 *  - join-scope (theme/meeting/...) → `orderBy { block: { updatedAt: desc } }`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — Б26 [K3] детерминированный pool', () => {
  let prismaStub: {
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockLink: { findMany: ReturnType<typeof vi.fn> };
    themeIdeaBlock: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embeddingsStub: { embedQuery: ReturnType<typeof vi.fn> };
  let cfgStub: { knowledgeCore: { chatV2TopBlocks: number } };
  let svc: ChatV2RetrievalService;

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn().mockResolvedValue([]) },
      themeIdeaBlock: { findMany: vi.fn() },
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

  it('org + qvec (без структурного фильтра) → HNSW pgvector ORDER BY embedding <=> qvec', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0.01));
    // 1-й $queryRawUnsafe = pool HNSW; 2-й = rankByCosineOrRecency.
    prismaStub.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }])
      .mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'какой бюджет на маркетинг',
      limit: 10,
      graphHops: 0,
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);
    // Первый сырой вызов — детерминированный HNSW pool (не случайный срез).
    const poolSql = prismaStub.$queryRawUnsafe.mock.calls[0]?.[0] as string;
    expect(poolSql).toContain('ORDER BY b.embedding <=>');
    expect(poolSql).toContain('LIMIT 5000');
    // org-pool через findMany не вызывался (HNSW заменил случайный срез).
    expect(prismaStub.ideaBlock.findMany).not.toHaveBeenCalled();
  });

  it('org без qvec → findMany pool с orderBy updatedAt desc', async () => {
    embeddingsStub.embedQuery.mockRejectedValue(new Error('no-embed'));
    prismaStub.ideaBlock.findMany
      // collectPool (org, recency-fallback).
      .mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }])
      // rankByCosineOrRecency recency-fallback.
      .mockResolvedValueOnce([
        { id: 'b1', updatedAt: new Date() },
        { id: 'b2', updatedAt: new Date() },
      ]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'q',
      limit: 10,
      graphHops: 0,
    });

    expect(result.length).toBe(2);
    const poolCall = prismaStub.ideaBlock.findMany.mock.calls[0]?.[0] as {
      orderBy?: { updatedAt?: string };
      take?: number;
    };
    expect(poolCall.orderBy).toEqual({ updatedAt: 'desc' });
    expect(poolCall.take).toBe(5000);
  });

  it('theme-scope pool → orderBy { block: { updatedAt: desc } } перед take 1000', async () => {
    embeddingsStub.embedQuery.mockRejectedValue(new Error('no-embed'));
    prismaStub.themeIdeaBlock.findMany.mockResolvedValueOnce([
      { blockId: 'b1' },
      { blockId: 'b2' },
    ]);
    // rankByCosineOrRecency recency-fallback по pool'у.
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([
      { id: 'b1', updatedAt: new Date() },
      { id: 'b2', updatedAt: new Date() },
    ]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'theme',
      scopeId: 'theme-1',
      query: 'q',
      limit: 10,
      graphHops: 0,
    });

    const poolCall = prismaStub.themeIdeaBlock.findMany.mock.calls[0]?.[0] as {
      orderBy?: { block?: { updatedAt?: string } };
      take?: number;
    };
    expect(poolCall.orderBy).toEqual({ block: { updatedAt: 'desc' } });
    expect(poolCall.take).toBe(1000);
  });
});
