import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  KnowledgeAccessContext,
  KnowledgeAccessResolver,
} from '../../rbac/knowledge-access-resolver.service';
import type { KnowledgeEmbeddingService } from '../services/embedding.service';

import { SearchService } from './search.service';

function makeCfg(enforcement: 'off' | 'shadow' | 'enforce' = 'off'): TypedConfigService {
  return {
    knowledgeAccess: { enforcement },
    knowledgeCore: { searchCosineWeight: 0.7, searchBm25Weight: 0.3 },
    bitemporal: { enabled: false },
  } as unknown as TypedConfigService;
}

function makeEmbeddings(): KnowledgeEmbeddingService {
  return {
    embedQuery: vi.fn(async () => null),
  } as unknown as KnowledgeEmbeddingService;
}

function makeResolver(overrides: Partial<KnowledgeAccessResolver> = {}): {
  resolver: KnowledgeAccessResolver;
  resolveSpy: ReturnType<typeof vi.fn>;
  predicateSpy: ReturnType<typeof vi.fn>;
  partitionSpy: ReturnType<typeof vi.fn>;
} {
  const resolveSpy = vi.fn(
    async (): Promise<KnowledgeAccessContext> => ({
      deptGroupIds: ['g-dept'],
      closedGroupIds: [],
      isBypass: false,
    }),
  );
  const predicateSpy = vi.fn((_ctx: unknown, pushParam: (v: unknown) => string) => {
    const p = pushParam(['g-dept']);
    return ` AND NOT EXISTS (SELECT 1 FROM "IdeaBlockAccess" a WHERE a."blockId" = b.id AND a."groupId" = ANY(${p}::text[]))`;
  });
  const partitionSpy = vi.fn(async (_ctx: unknown, ids: string[]) => ({
    accessible: ids,
    denied: 0,
  }));
  const resolver = {
    resolveAccessibleGroups: resolveSpy,
    buildAccessSqlPredicate: predicateSpy,
    partitionBlockIdsByAccess: partitionSpy,
    ...overrides,
  } as unknown as KnowledgeAccessResolver;
  return { resolver, resolveSpy, predicateSpy, partitionSpy };
}

function makeMetrics(): {
  metrics: BusinessMetricsService;
  shadowSpy: ReturnType<typeof vi.fn>;
} {
  const shadowSpy = vi.fn();
  const metrics = {
    incAccessShadowDiff: shadowSpy,
    incAccessDenied: vi.fn(),
  } as unknown as BusinessMetricsService;
  return { metrics, shadowSpy };
}

function buildFakePrisma(captured: { sql: string | null }): PrismaService {
  return {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      captured.sql = sql;
      return [
        {
          id: 'b-1',
          tenantId: 't-A',
          name: 'block',
          criticalQuestion: 'q?',
          trustedAnswer: 'a.',
          tags: [],
          signalType: 'idea',
          confidence: 0.7,
          status: 'canonical',
          evidenceCount: 0,
          createdAt: new Date('2026-06-06T00:00:00Z'),
          updatedAt: new Date('2026-06-06T00:00:00Z'),
          cosine_score: 0,
          bm25_score: 0,
          combined_score: 0,
        },
      ];
    }),
    ideaBlockEvidence: { findMany: vi.fn(async () => []) },
    ideaBlockEntity: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;
}

describe('SearchService — Ф4 гейт доступа (knowledge-access)', () => {
  it('off: SQL без IdeaBlockAccess, resolver НЕ вызывается', async () => {
    const captured: { sql: string | null } = { sql: null };
    const prisma = buildFakePrisma(captured);
    const { resolver, resolveSpy } = makeResolver();
    const { metrics } = makeMetrics();
    const svc = new SearchService(prisma, makeCfg('off'), makeEmbeddings(), resolver, metrics);

    await svc.search({ query: 'тест', limit: 10, tenantId: 't-A', userId: 'u-1' });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.sql).not.toBeNull();
    expect(captured.sql).not.toContain('IdeaBlockAccess');
  });

  it('enforce: SQL содержит предикат IdeaBlockAccess', async () => {
    const captured: { sql: string | null } = { sql: null };
    const prisma = buildFakePrisma(captured);
    const { resolver, resolveSpy, predicateSpy } = makeResolver();
    const { metrics } = makeMetrics();
    const svc = new SearchService(prisma, makeCfg('enforce'), makeEmbeddings(), resolver, metrics);

    await svc.search({ query: 'тест', limit: 10, tenantId: 't-A', userId: 'u-1' });

    expect(resolveSpy).toHaveBeenCalledWith({ tenantId: 't-A', userId: 'u-1' });
    expect(predicateSpy).toHaveBeenCalled();
    expect(captured.sql).toContain('IdeaBlockAccess');
    expect(captured.sql).toContain('(1=1');
  });

  it('enforce + bypass: SQL без предиката (owner видит всё)', async () => {
    const captured: { sql: string | null } = { sql: null };
    const prisma = buildFakePrisma(captured);
    const { resolver, predicateSpy } = makeResolver({
      resolveAccessibleGroups: vi.fn(
        async (): Promise<KnowledgeAccessContext> => ({
          deptGroupIds: [],
          closedGroupIds: [],
          isBypass: true,
        }),
      ) as unknown as KnowledgeAccessResolver['resolveAccessibleGroups'],
    });
    const { metrics } = makeMetrics();
    const svc = new SearchService(prisma, makeCfg('enforce'), makeEmbeddings(), resolver, metrics);

    await svc.search({ query: 'тест', limit: 10, tenantId: 't-A', userId: 'u-1' });

    expect(predicateSpy).not.toHaveBeenCalled();
    expect(captured.sql).not.toContain('IdeaBlockAccess');
  });

  it('enforce без userId: гейт не активируется (обратная совместимость)', async () => {
    const captured: { sql: string | null } = { sql: null };
    const prisma = buildFakePrisma(captured);
    const { resolver, resolveSpy } = makeResolver();
    const { metrics } = makeMetrics();
    const svc = new SearchService(prisma, makeCfg('enforce'), makeEmbeddings(), resolver, metrics);

    await svc.search({ query: 'тест', limit: 10, tenantId: 't-A' });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(captured.sql).not.toContain('IdeaBlockAccess');
  });

  it('shadow: SQL без предиката, считается метрика denied', async () => {
    const captured: { sql: string | null } = { sql: null };
    const prisma = buildFakePrisma(captured);
    const partitionSpy = vi.fn(async (_ctx: unknown, ids: string[]) => ({
      accessible: ids,
      denied: 1,
    }));
    const { resolver } = makeResolver({
      partitionBlockIdsByAccess:
        partitionSpy as unknown as KnowledgeAccessResolver['partitionBlockIdsByAccess'],
    });
    const { metrics, shadowSpy } = makeMetrics();
    const svc = new SearchService(prisma, makeCfg('shadow'), makeEmbeddings(), resolver, metrics);

    await svc.search({ query: 'тест', limit: 10, tenantId: 't-A', userId: 'u-1' });

    expect(captured.sql).not.toContain('IdeaBlockAccess');
    expect(partitionSpy).toHaveBeenCalled();
    expect(shadowSpy).toHaveBeenCalledWith({ surface: 'search' }, 1);
  });
});
