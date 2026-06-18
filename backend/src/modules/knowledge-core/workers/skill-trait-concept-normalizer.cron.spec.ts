import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillTraitConceptNormalizerCron } from './skill-trait-concept-normalizer.cron';

interface FakeConceptRow {
  id: string;
  canonical_name: string;
  trait_count: number;
  variants: string[];
  embedding_text: string | null;
}

function vec(values: number[]): string {
  return `[${values.join(',')}]`;
}

function similarVectors(sim: number): { a: number[]; b: number[] } {
  const theta = Math.acos(sim);
  return {
    a: [1, 0],
    b: [Math.cos(theta), Math.sin(theta)],
  };
}

function buildCron(args: {
  conceptRows: FakeConceptRow[];
  archiveCount?: number;
  liveCounts?: Record<string, number>;
  mergeReturns?: boolean;
}) {
  const concepts = args.conceptRows;
  const mergeCalls: Array<{ targetId: string; sourceIds: string[] }> = [];
  const probeCalls: any[] = [];

  const prisma = {
    org: {
      findMany: vi.fn(async () => [{ id: 't1' }]),
    },
    skillTraitConcept: {
      updateMany: vi.fn(async () => ({ count: args.archiveCount ?? 0 })),
      groupBy: vi.fn(async () => [{ status: 'active', _count: { _all: concepts.length } }]),
      findMany: vi.fn(async () => []),
    },
    skillTrait: {
      groupBy: vi.fn(async () =>
        concepts.map((c) => ({
          conceptId: c.id,
          _count: {
            _all: args.liveCounts ? (args.liveCounts[c.id] ?? 0) : c.trait_count,
          },
        })),
      ),
    },
    membership: {
      findMany: vi.fn(async () => [{ userId: 'admin-1' }]),
    },
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('FROM "skill_trait_concepts"')) {
        return concepts;
      }
      return [];
    }),
  };
  const redis = {
    client: {
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
    },
  };
  const cfg = {
    skill: {
      conceptMatchThreshold: 0.85,
      conceptMergeThreshold: 0.92,
      conceptArchiveAfterMonths: 6,
    },
  } as any;
  const metrics = {
    incSkillTraitConceptsMerged: vi.fn(),
    setSkillTraitConceptsTotal: vi.fn(),
  } as any;
  const llm = {
    call: vi.fn(async () => ({
      text: JSON.stringify({
        canonicalName: 'осторожен с оценками сроков',
        reasoning: 'тест',
      }),
      modelUsed: 'mock',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 0,
    })),
  } as any;
  const concepts$ = {
    mergeConcepts: vi.fn(async (a: any) => {
      mergeCalls.push({ targetId: a.targetId, sourceIds: a.sourceIds });
      return args.mergeReturns ?? true;
    }),
    findOrCreateConcept: vi.fn(),
    recomputeConceptForTrait: vi.fn(),
    recomputeTraitCount: vi.fn(),
  } as any;
  const probe = {
    suggest: vi.fn(async (args: any) => {
      probeCalls.push(args);
      return { ok: true };
    }),
  } as any;

  const cron = new SkillTraitConceptNormalizerCron(
    prisma as any,
    redis as any,
    cfg,
    metrics,
    llm,
    concepts$,
    probe,
  );
  return { cron, mergeCalls, probeCalls, prisma, redis, llm };
}

describe('SkillTraitConceptNormalizerCron', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('сценарий 1: два близких концепта (similarity 0.95) — сливаются в опорный с max traitCount', async () => {
    const { a, b } = similarVectors(0.95);
    const rows: FakeConceptRow[] = [
      {
        id: 'c-strong',
        canonical_name: 'осторожен с оценками сроков',
        trait_count: 10,
        variants: ['осторожен с оценками сроков'],
        embedding_text: vec(a),
      },
      {
        id: 'c-weak',
        canonical_name: 'не любит давать сроки без данных',
        trait_count: 3,
        variants: ['не любит давать сроки без данных'],
        embedding_text: vec(b),
      },
    ];
    const { cron, mergeCalls } = buildCron({ conceptRows: rows });
    const summary = await cron.runOnce();

    expect(summary.tenantsScanned).toBe(1);
    expect(summary.clustersMerged).toBe(1);
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]!.targetId).toBe('c-strong');
    expect(mergeCalls[0]!.sourceIds).toEqual(['c-weak']);
  });

  it('сценарий 2: один близкий (0.85) и один далёкий (0.5) — порог слияния 0.92, поэтому НЕ сливаются', async () => {
    const { a, b: bClose } = similarVectors(0.85);
    const { b: bFar } = similarVectors(0.5);
    const rows: FakeConceptRow[] = [
      {
        id: 'c-a',
        canonical_name: 'осторожен с оценками',
        trait_count: 5,
        variants: ['осторожен с оценками'],
        embedding_text: vec(a),
      },
      {
        id: 'c-close',
        canonical_name: 'не любит сроки без данных',
        trait_count: 3,
        variants: ['не любит сроки без данных'],
        embedding_text: vec(bClose),
      },
      {
        id: 'c-far',
        canonical_name: 'делегирует решения',
        trait_count: 2,
        variants: ['делегирует решения'],
        embedding_text: vec(bFar),
      },
    ];
    const { cron, mergeCalls } = buildCron({ conceptRows: rows });
    const summary = await cron.runOnce();

    expect(summary.clustersMerged).toBe(0);
    expect(mergeCalls).toHaveLength(0);
  });

  it('сценарий 3: концепт без активных traits старше 6 мес — архивируется по traits.none (Б7), не по счётчику', async () => {
    const { cron, prisma } = buildCron({
      conceptRows: [],
      archiveCount: 2,
    });
    const summary = await cron.runOnce();

    expect(summary.conceptsArchived).toBe(2);
    expect(prisma.skillTraitConcept.updateMany).toHaveBeenCalledTimes(1);
    const call = (prisma.skillTraitConcept.updateMany as any).mock.calls[0][0];
    expect(call.where.status).toBe('active');
    expect(call.where.traitCount).toBeUndefined();
    expect(call.where.traits).toEqual({ none: { status: 'active' } });
    expect(call.where.lastSeenAt.lt).toBeInstanceOf(Date);
    expect(call.data.status).toBe('archived');
  });

  it('Б6: опорный концепт выбирается по ЖИВОМУ COUNT(active), а не по дрейфующему traitCount', async () => {
    const { a, b } = similarVectors(0.95);
    const rows: FakeConceptRow[] = [
      {
        id: 'c-a',
        canonical_name: 'имя A',
        trait_count: 10,
        variants: ['имя A'],
        embedding_text: vec(a),
      },
      {
        id: 'c-b',
        canonical_name: 'имя B',
        trait_count: 3,
        variants: ['имя B'],
        embedding_text: vec(b),
      },
    ];
    const { cron, mergeCalls } = buildCron({
      conceptRows: rows,
      liveCounts: { 'c-a': 1, 'c-b': 8 },
    });
    const summary = await cron.runOnce();

    expect(summary.clustersMerged).toBe(1);
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]!.targetId).toBe('c-b');
    expect(mergeCalls[0]!.sourceIds).toEqual(['c-a']);
  });

  it('Б8: mergeConcepts вернул false (no-op) — clustersMerged НЕ инкрементится, probe не шлётся', async () => {
    const { a, b } = similarVectors(0.95);
    const rows: FakeConceptRow[] = [
      {
        id: 'c-strong',
        canonical_name: 'имя один',
        trait_count: 10,
        variants: ['имя один'],
        embedding_text: vec(a),
      },
      {
        id: 'c-weak',
        canonical_name: 'имя два',
        trait_count: 3,
        variants: ['имя два'],
        embedding_text: vec(b),
      },
    ];
    const { cron, mergeCalls, probeCalls } = buildCron({
      conceptRows: rows,
      mergeReturns: false,
    });
    const summary = await cron.runOnce();

    expect(mergeCalls).toHaveLength(1);
    expect(summary.clustersMerged).toBe(0);
    expect(summary.probesSent).toBe(0);
    expect(probeCalls).toHaveLength(0);
  });
});
