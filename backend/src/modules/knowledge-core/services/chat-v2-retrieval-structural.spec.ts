import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStructuralPredicates, ChatV2RetrievalService } from './chat-v2-retrieval.service';

function makePushParam(): { push: (v: unknown) => string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  return { push, params };
}

describe('buildStructuralPredicates — recall-safe ядро предикатов', () => {
  it('signalTypes:[decision] → "signalType"::text IN ($) + параметр decision', () => {
    const { push, params } = makePushParam();
    const preds = buildStructuralPredicates(
      { tenantParamRef: '$1', signalTypes: ['decision'] },
      push,
    );
    expect(preds).toHaveLength(1);
    expect(preds[0]).toContain('"signalType"::text IN ($');
    expect(params).toContain('decision');
  });

  it('dateFrom+dateTo → EXISTS IdeaBlockEvidence + sourceTimestamp >= и <=, оба Date-параметра', () => {
    const { push, params } = makePushParam();
    const from = new Date('2026-06-08T00:00:00Z');
    const to = new Date('2026-06-14T23:59:59Z');
    const preds = buildStructuralPredicates(
      { tenantParamRef: '$1', dateFrom: from, dateTo: to },
      push,
    );
    expect(preds).toHaveLength(1);
    const p = preds[0];
    expect(p).toContain('EXISTS');
    expect(p).toContain('"IdeaBlockEvidence"');
    expect(p).toContain('"sourceTimestamp" >=');
    expect(p).toContain('"sourceTimestamp" <=');
    expect(params).toContain(from);
    expect(params).toContain(to);
  });

  it('themeBranches:[marketing] → ThemeIdeaBlock + JOIN "Theme" + "branch"::text IN, параметр marketing, и tenantParamRef в предикате', () => {
    const { push, params } = makePushParam();
    const preds = buildStructuralPredicates(
      { tenantParamRef: '$1', themeBranches: ['marketing'] },
      push,
    );
    expect(preds).toHaveLength(1);
    const p = preds[0];
    expect(p).toContain('"ThemeIdeaBlock"');
    expect(p).toContain('JOIN "Theme"');
    expect(p).toContain('"branch"::text IN');
    expect(p).toContain('t."tenantId" = $1');
    expect(params).toContain('marketing');
  });

  it('bitemporalActiveOnly:true → b."validUntil" IS NULL, без параметра', () => {
    const { push, params } = makePushParam();
    const preds = buildStructuralPredicates(
      { tenantParamRef: '$1', bitemporalActiveOnly: true },
      push,
    );
    expect(preds).toEqual(['b."validUntil" IS NULL']);
    expect(params).toHaveLength(0);
  });

  it('entityIds:[e1,e2] → EXISTS IdeaBlockEntity с двумя параметрами', () => {
    const { push, params } = makePushParam();
    const preds = buildStructuralPredicates(
      { tenantParamRef: '$1', entityIds: ['e1', 'e2'] },
      push,
    );
    expect(preds).toHaveLength(1);
    expect(preds[0]).toContain('"IdeaBlockEntity"');
    expect(preds[0]).toContain('EXISTS');
    expect(params).toEqual(['e1', 'e2']);
  });

  it('пустые args → []', () => {
    const { push, params } = makePushParam();
    const preds = buildStructuralPredicates({ tenantParamRef: '$1' }, push);
    expect(preds).toEqual([]);
    expect(params).toHaveLength(0);
  });
});

describe('ChatV2RetrievalService — структурный фильтр (роутинг)', () => {
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
      ideaBlock: { findMany: vi.fn() },
      ideaBlockLink: { findMany: vi.fn() },
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

  it('активный структурный фильтр → rankByStructuralFilter SQL + граф ПРОПУЩЕН', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([{ id: 'b1', score: 0.9 }]);
    prismaStub.ideaBlockLink.findMany.mockResolvedValue([]);

    const result = await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что решали по маркетингу',
      limit: 10,
      graphHops: 1,
      signalTypes: ['decision'],
    });

    expect(result.map((r) => r.blockId)).toEqual(['b1']);

    expect(prismaStub.$queryRawUnsafe).toHaveBeenCalled();
    const sqlArg = prismaStub.$queryRawUnsafe.mock.calls[0]?.[0] as string;
    expect(sqlArg).toContain('"signalType"::text IN');
    expect(sqlArg).toContain('ORDER BY score DESC');
    expect(sqlArg).not.toContain('ORDER BY b.embedding <=>');

    expect(prismaStub.ideaBlockLink.findMany).not.toHaveBeenCalled();
  });

  it('негатив по дате: предикат окна и границы wired (исключение out-of-window — Ф5 интеграция)', async () => {
    embeddingsStub.embedQuery.mockResolvedValue(new Array(1536).fill(0));
    prismaStub.ideaBlock.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaStub.$queryRawUnsafe.mockResolvedValueOnce([]);

    const from = new Date('2026-06-08T00:00:00Z');
    const to = new Date('2026-06-14T23:59:59Z');
    await svc.fetchCandidates({
      tenantId: 't',
      scope: 'org',
      scopeId: null,
      query: 'что обсуждали на этой неделе',
      limit: 10,
      graphHops: 0,
      dateFrom: from,
      dateTo: to,
    });

    const call = prismaStub.$queryRawUnsafe.mock.calls[0];
    const sqlArg = call?.[0] as string;
    const params = call?.slice(1) ?? [];
    expect(sqlArg).toContain('"IdeaBlockEvidence"');
    expect(sqlArg).toContain('"sourceTimestamp" >=');
    expect(sqlArg).toContain('"sourceTimestamp" <=');
    expect(params).toContain(from);
    expect(params).toContain(to);
  });

  it('регрессия: без структурного фильтра + qvec null → recency-путь, $queryRawUnsafe (структурный) НЕ вызван, граф работает', async () => {
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
      query: 'какой бюджет на маркетинг',
      limit: 10,
      graphHops: 1,
    });

    expect(result.length).toBe(2);
    expect(prismaStub.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(prismaStub.ideaBlockLink.findMany).toHaveBeenCalled();
  });
});
