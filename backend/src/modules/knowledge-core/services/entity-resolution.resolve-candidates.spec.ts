import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

interface Stubs {
  alias: { personId: string } | null;
  aliveIds: Set<string>;
  trigramRows: Array<{ id: string; score: number }>;
  embeddingRows: Array<{ id: string; score: number }>;
  narrowRows: Array<{ personId: string }>;
  entityCanon: Array<{ id: string; mergedIntoId: string | null }>;
  getDynamic?: (key: string) => number;
}

function makeService(stubs: Stubs): {
  svc: EntityResolutionService;
  queryCalls: Array<{ sql: string; params: unknown[] }>;
} {
  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];

  const prisma = {
    entityAlias: {
      findUnique: vi.fn(async () => stubs.alias),
    },
    person: {
      findFirst: vi.fn(async (args: { where: { id?: string } }) => {
        const id = args.where.id;
        if (id && stubs.aliveIds.has(id)) return { id };
        return null;
      }),
    },
    entity: {
      findMany: vi.fn(async () => stubs.entityCanon),
      findUnique: vi.fn(
        async (args: { where: { id_tenantId: { id: string } } }) => {
          const id = args.where.id_tenantId.id;
          const row = stubs.entityCanon.find((e) => e.id === id);
          return row ? { mergedIntoId: row.mergedIntoId } : { mergedIntoId: null };
        },
      ),
    },
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      queryCalls.push({ sql, params });
      if (sql.includes('similarity(') && sql.includes('"persons"')) {
        return stubs.trigramRows;
      }
      if (sql.includes('"Person"') && sql.includes('embedding')) {
        return stubs.embeddingRows;
      }
      if (sql.includes('"SourceParticipant"') && sql.includes('"SourceEntity"')) {
        return stubs.narrowRows;
      }
      return [];
    }),
  } as unknown as PrismaService;

  const embed = {
    embedQuery: vi.fn(async () => new Array<number>(1536).fill(0)),
    embedEntityNames: vi.fn(async (names: string[]) =>
      names.map(() => new Array<number>(1536).fill(0)),
    ),
  } as unknown as KnowledgeEmbeddingService;

  const cfg = {
    getDynamic: vi.fn(async (key: string, _ctx: unknown, fallback: number) =>
      stubs.getDynamic ? stubs.getDynamic(key) : fallback,
    ),
  } as unknown as TypedConfigService;

  const svc = new EntityResolutionService(
    prisma,
    embed,
    undefined,
    undefined,
    undefined,
    cfg,
  );
  return { svc, queryCalls };
}

const EMPTY: Omit<Stubs, 'trigramRows' | 'embeddingRows'> = {
  alias: null,
  aliveIds: new Set<string>(),
  narrowRows: [],
  entityCanon: [],
};

describe('EntityResolutionService.resolvePersonCandidates (Ф4 R14)', () => {
  it('опечатка («Алексан», триграмма) и алиас («Саша») → тот же Person P', async () => {
    const trig = makeService({
      ...EMPTY,
      trigramRows: [{ id: 'P', score: 0.42 }],
      embeddingRows: [],
    });
    const byTrigram = await trig.svc.resolvePersonCandidates({
      tenantId: 't1',
      hint: 'Алексан',
    });
    expect(byTrigram[0]?.personId).toBe('P');

    const alias = makeService({
      ...EMPTY,
      alias: { personId: 'P' },
      aliveIds: new Set(['P']),
      trigramRows: [],
      embeddingRows: [],
    });
    const byAlias = await alias.svc.resolvePersonCandidates({
      tenantId: 't1',
      hint: 'Саша',
    });
    expect(byAlias[0]?.personId).toBe('P');
    expect(byAlias[0]?.confidence).toBe(1);
  });

  it('триграммный SQL параметризован, tenantId первым ($1), точного равенства имени нет', async () => {
    const { svc, queryCalls } = makeService({
      ...EMPTY,
      trigramRows: [{ id: 'P', score: 0.5 }],
      embeddingRows: [],
    });
    await svc.resolvePersonCandidates({ tenantId: 't-xyz', hint: 'Иван' });
    const trigramCall = queryCalls.find((c) => c.sql.includes('similarity('));
    expect(trigramCall).toBeDefined();
    expect(trigramCall!.sql).toContain('"tenantId" = $1');
    expect(trigramCall!.sql).toContain('"deletedAt" IS NULL');
    expect(trigramCall!.sql).not.toMatch(/"name"\s*=\s*\$/);
    expect(trigramCall!.params[0]).toBe('t-xyz');
  });

  it('контекст сужает: 2 Александра, контекст «Молочные реки» → один, без переспроса', async () => {
    const { svc } = makeService({
      ...EMPTY,
      trigramRows: [
        { id: 'A1', score: 0.6 },
        { id: 'A2', score: 0.58 },
      ],
      embeddingRows: [],
      entityCanon: [{ id: 'company-milk', mergedIntoId: null }],
      narrowRows: [{ personId: 'A2' }],
    });
    const candidates = await svc.resolvePersonCandidates({
      tenantId: 't1',
      hint: 'Александр',
      contextEntityIds: ['company-milk'],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.personId).toBe('A2');
  });

  it('merged контекст-сущность резолвится в канон перед сужением', async () => {
    const { svc, queryCalls } = makeService({
      ...EMPTY,
      trigramRows: [
        { id: 'A1', score: 0.6 },
        { id: 'A2', score: 0.58 },
      ],
      embeddingRows: [],
      entityCanon: [{ id: 'company-dup', mergedIntoId: 'company-canon' }],
      narrowRows: [{ personId: 'A1' }],
    });
    await svc.resolvePersonCandidates({
      tenantId: 't1',
      hint: 'Александр',
      contextEntityIds: ['company-dup'],
    });
    const narrowCall = queryCalls.find((c) =>
      c.sql.includes('"SourceParticipant"'),
    );
    expect(narrowCall).toBeDefined();
    expect(narrowCall!.params).toContainEqual(['company-canon']);
  });

  it('пустой резолв (нет кандидатов) → []', async () => {
    const { svc } = makeService({
      ...EMPTY,
      trigramRows: [],
      embeddingRows: [],
    });
    const candidates = await svc.resolvePersonCandidates({
      tenantId: 't1',
      hint: 'Неизвестный',
    });
    expect(candidates).toEqual([]);
  });
});
