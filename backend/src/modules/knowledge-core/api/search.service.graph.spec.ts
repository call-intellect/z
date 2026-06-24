import { describe, expect, it, vi } from 'vitest';

import { SearchService } from './search.service';

interface FakeRow {
  id: string;
  tenantId: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: string[];
  signalType: string;
  confidence: number;
  status: string;
  evidenceCount: number;
  createdAt: Date;
  updatedAt: Date;
  cosine_score: number;
  bm25_score: number;
  combined_score: number;
}

function makeRow(id: string, combined: number): FakeRow {
  return {
    id,
    tenantId: 'tenant-1',
    name: `block ${id}`,
    criticalQuestion: 'q',
    trustedAnswer: 'a',
    tags: [],
    signalType: 'methodology',
    confidence: 0.9,
    status: 'canonical',
    evidenceCount: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    cosine_score: combined,
    bm25_score: 0,
    combined_score: combined,
  };
}

function buildService(opts: {
  hybridRows: FakeRow[];
  graphRows: FakeRow[];
  links: Array<{ fromBlockId: string; toBlockId: string; confidence: number; validUntil: Date | null }>;
  bitemporalEnabled?: boolean;
}) {
  const linkFindMany = vi.fn(async (_params: { where: Record<string, unknown> }) => {
    return opts.links.map((l) => ({
      fromBlockId: l.fromBlockId,
      toBlockId: l.toBlockId,
      confidence: l.confidence,
    }));
  });

  const queryRawUnsafe = vi
    .fn()
    .mockResolvedValueOnce(opts.hybridRows)
    .mockResolvedValueOnce(opts.graphRows);

  const prisma = {
    ideaBlockLink: { findMany: linkFindMany },
    ideaBlockEvidence: { findMany: vi.fn(async () => []) },
    ideaBlockEntity: { findMany: vi.fn(async () => []) },
    $queryRawUnsafe: queryRawUnsafe,
  };

  const cfg = {
    knowledgeAccess: { enforcement: 'off' as const },
    knowledgeCore: { searchCosineWeight: 0.6, searchBm25Weight: 0.4 },
    bitemporal: { enabled: opts.bitemporalEnabled ?? false },
    ai: { embeddings: { dimensions: 1536 } },
    getDynamic: vi.fn(async (key: string, _env: unknown, def: number) => {
      if (key === 'knowledge.search_expand_hops') return 1;
      if (key === 'knowledge.search_rrf_k') return 60;
      return def;
    }),
  };

  const embeddings = { embedQuery: vi.fn(async () => null) };

  const accessResolver = {
    resolveAccessibleGroups: vi.fn(),
    partitionBlockIdsByAccess: vi.fn(),
    buildAccessSqlPredicate: vi.fn(() => ''),
  };

  const metrics = { incAccessShadowDiff: vi.fn() };

  const service = new SearchService(
    prisma as never,
    cfg as never,
    embeddings as never,
    accessResolver as never,
    metrics as never,
  );

  return { service, prisma, cfg, linkFindMany, queryRawUnsafe };
}

describe('SearchService — граф-обход + RRF (Ф7)', () => {
  it('R10: блок, достижимый ТОЛЬКО через ребро, попадает в выдачу', async () => {
    const seed = makeRow('seed-1', 0.9);
    const external = makeRow('external-1', 0.1);

    const { service } = buildService({
      hybridRows: [seed],
      graphRows: [external],
      links: [{ fromBlockId: 'seed-1', toBlockId: 'external-1', confidence: 0.8, validUntil: null }],
    });

    const out = await service.search({
      query: 'тест',
      limit: 10,
      tenantId: 'tenant-1',
    } as never);

    const ids = out.results.map((r) => r.block.id);
    expect(ids).toContain('seed-1');
    expect(ids).toContain('external-1');
  });

  it('superseded скрыт: при bitemporal.enabled граф-запрос фильтрует validUntil:null', async () => {
    const seed = makeRow('seed-1', 0.9);

    const { service, linkFindMany } = buildService({
      hybridRows: [seed],
      graphRows: [],
      links: [],
      bitemporalEnabled: true,
    });

    await service.search({
      query: 'тест',
      limit: 10,
      tenantId: 'tenant-1',
    } as never);

    expect(linkFindMany).toHaveBeenCalledTimes(1);
    const call = linkFindMany.mock.calls[0];
    if (!call) throw new Error('ideaBlockLink.findMany не был вызван');
    const where = call[0].where as Record<string, unknown>;
    expect(where.validUntil).toBeNull();
    expect(where.status).toBe('active');
    expect(where.deletedAt).toBeNull();
  });

  it('без bitemporal граф-запрос НЕ ставит фильтр validUntil', async () => {
    const seed = makeRow('seed-1', 0.9);

    const { service, linkFindMany } = buildService({
      hybridRows: [seed],
      graphRows: [],
      links: [],
      bitemporalEnabled: false,
    });

    await service.search({
      query: 'тест',
      limit: 10,
      tenantId: 'tenant-1',
    } as never);

    const call = linkFindMany.mock.calls[0];
    if (!call) throw new Error('ideaBlockLink.findMany не был вызван');
    const where = call[0].where as Record<string, unknown>;
    expect('validUntil' in where).toBe(false);
  });

  it('expand_hops=0 пропускает обход: граф-запрос не вызывается', async () => {
    const seed = makeRow('seed-1', 0.9);

    const { service, linkFindMany, cfg } = buildService({
      hybridRows: [seed],
      graphRows: [],
      links: [{ fromBlockId: 'seed-1', toBlockId: 'external-1', confidence: 0.8, validUntil: null }],
    });
    cfg.getDynamic.mockImplementation(async (key: string, _env: unknown, def: number) => {
      if (key === 'knowledge.search_expand_hops') return 0;
      return def;
    });

    const out = await service.search({
      query: 'тест',
      limit: 10,
      tenantId: 'tenant-1',
    } as never);

    expect(linkFindMany).not.toHaveBeenCalled();
    expect(out.results.map((r) => r.block.id)).toEqual(['seed-1']);
  });
});
