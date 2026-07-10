import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';

describe('ChatV2RetrievalService — структурный фильтр как boost', () => {
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

  it('boost-режим + entityIds → boost-SQL (CASE WHEN, ORDER BY score DESC), без WHERE-cutoff по entity', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(768).fill(0.01));
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 1.2 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 0,
      entityIds: ['e429'],
      filterMode: 'boost',
      filterBoostWeight: 0.3,
    });

    const sqls = prismaStub.$queryRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(
      sqls.some((s) => s.includes('CASE WHEN') && s.includes('ORDER BY score DESC')),
    ).toBe(true);
    expect(
      sqls.some(
        (s) => s.includes('ORDER BY score DESC') && s.includes('"IdeaBlockEntity"'),
      ),
    ).toBe(true);
    expect(sqls.some((s) => s.includes('CASE WHEN') && s.includes('::float8'))).toBe(
      true,
    );
  });

  it('hard-режим (filterMode:hard) + entityIds → rankByStructuralFilter (WHERE-cutoff), без CASE WHEN', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(768).fill(0));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
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
      filterMode: 'hard',
    });

    const sqls = prismaStub.$queryRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes('CASE WHEN'))).toBe(false);
    expect(
      sqls.some(
        (s) => s.includes('ORDER BY score DESC') && s.includes('"IdeaBlockEntity"'),
      ),
    ).toBe(true);
  });

  it('boost без qvec (embed упал) → recency-findMany, cutoff нет, не падает', async () => {
    embeddingsStub.embedQuery.mockRejectedValue(new Error('no'));
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
      query: 'что с ошибкой 429',
      limit: 10,
      graphHops: 0,
      entityIds: ['e429'],
      filterMode: 'boost',
    });

    expect(result.length).toBe(2);
    expect(prismaStub.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
