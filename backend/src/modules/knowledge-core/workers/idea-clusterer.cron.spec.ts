import { describe, expect, it, vi } from 'vitest';

import { IdeaClustererCron } from './idea-clusterer.cron';

/**
 * Аудит-баги класса K10 (кластеризация идей), MASTER §3.2/§4.
 *
 * Б8  — `IdeaCluster.embedding` НИКОГДА не писался → KNN-фильтр
 *       `embedding IS NOT NULL` в findNearestCluster отсекал все кластеры →
 *       кластеры не дополнялись (мёртвый код). Фикс: на create И на attach
 *       пишем embedding = mean(векторов участников) сырым `UPDATE ... ::vector`.
 *
 * Б39 — остаток накопителя < minSupporters раньше молча выпадал из прохода и
 *       оставался вечным orphan'ом. Фикс: финальный flush — хвост ≥2 идей
 *       кластеризуется (ignoreMinSupporters), хвост из 1 идеи логируется.
 *
 * Тесты детерминированные, Prisma замокана (без БД), гоняются в test:unit.
 */

interface FakeIdea {
  id: string;
  tenantId: string;
  statement: string;
  rationale: string | null;
  weight: number;
  dataClass: string;
  status: string;
}

function makeIdea(over: Partial<FakeIdea> & { id: string }): FakeIdea {
  return {
    tenantId: 'org_1',
    statement: `statement ${over.id}`,
    rationale: null,
    weight: 1,
    dataClass: 'internal',
    status: 'captured',
    ...over,
  };
}

function makeCron(args: {
  ideas: FakeIdea[];
  minSupporters?: number;
  threshold?: number;
  /** map ideaId → существующий кластер (KNN-hit), иначе miss. */
  nearestByIdea?: Record<string, { id: string; ideaIds: string[] } | null>;
}) {
  const minSupporters = args.minSupporters ?? 2;
  const threshold = args.threshold ?? 0.8;

  // Раздельные шпионы по «таблицам» raw-SQL: KNN (findNearest) vs read idea
  // embeddings (recomputeClusterEmbedding) vs write cluster embedding.
  const knnSpy = vi.fn();
  const readIdeaEmbeddingsSpy = vi.fn(
    async (_sql: string, _tenant: string, ids: string[]) =>
      ids.map((id) => ({ embedding: `[${id === 'no-emb' ? '' : '0.1,0.2,0.3'}]` })),
  );
  const executeRawSpy = vi.fn(
    async (..._args: [sql: string, ...params: unknown[]]) => 1,
  );

  const queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) => {
    if (sql.includes('idea_clusters') && sql.includes('<=>')) {
      // findNearestCluster KNN
      const ideaId = params[1] as string;
      const hit = args.nearestByIdea?.[ideaId] ?? null;
      knnSpy(ideaId);
      if (!hit) return [];
      return [{ id: hit.id, distance: 0 }];
    }
    if (sql.includes('FROM "ideas"') && sql.includes('embedding')) {
      // recomputeClusterEmbedding — read member idea embeddings
      return readIdeaEmbeddingsSpy(sql, params[0] as string, params[1] as string[]);
    }
    return [];
  });

  const clusterCreateSpy = vi.fn(async () => ({ id: 'cl_new' }));
  const clusterUpdateSpy = vi.fn(async () => ({ id: 'cl_x' }));
  const ideaUpdateSpy = vi.fn(async () => ({}));
  const ideaUpdateManySpy = vi.fn(async () => ({ count: 1 }));

  const fakePrisma = {
    org: { findMany: async () => [{ id: 'org_1' }] },
    idea: {
      findMany: vi.fn(async (q: { where: { id?: { in: string[] } } }) => {
        if (q.where.id?.in) {
          // attachToCluster recompute weights
          return q.where.id.in.map((id) => ({ id, weight: 1 }));
        }
        return args.ideas;
      }),
      update: ideaUpdateSpy,
      updateMany: ideaUpdateManySpy,
    },
    ideaCluster: {
      create: clusterCreateSpy,
      update: clusterUpdateSpy,
      findFirst: vi.fn(async (q: { where: { id: string } }) => {
        const hit = Object.values(args.nearestByIdea ?? {}).find(
          (c) => c && c.id === q.where.id,
        );
        return hit ?? null;
      }),
      findMany: async () => [],
    },
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawSpy,
  } as unknown as ConstructorParameters<typeof IdeaClustererCron>[0];

  const fakeCfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    ideas: {
      clusterThreshold: threshold,
      minSupportersForCluster: minSupporters,
    },
  } as unknown as ConstructorParameters<typeof IdeaClustererCron>[1];

  const fakeEmbedder = {} as unknown as ConstructorParameters<
    typeof IdeaClustererCron
  >[2];
  const fakeLlm = {
    call: vi.fn(async () => ({ text: '{}', modelUsed: null })),
  } as unknown as ConstructorParameters<typeof IdeaClustererCron>[3];
  const fakeMetrics = {
    incCoreSpecialistLlmTokens: vi.fn(),
  } as unknown as ConstructorParameters<typeof IdeaClustererCron>[4];

  return {
    cron: new IdeaClustererCron(
      fakePrisma,
      fakeCfg,
      fakeEmbedder,
      fakeLlm,
      fakeMetrics,
    ),
    executeRawSpy,
    clusterCreateSpy,
    clusterUpdateSpy,
    readIdeaEmbeddingsSpy,
    ideaUpdateManySpy,
  };
}

describe('IdeaClustererCron — Б8: embedding кластера = mean(участников)', () => {
  it('на CREATE кластера пишет embedding сырым UPDATE ::vector(1536)', async () => {
    const { cron, clusterCreateSpy, executeRawSpy } = makeCron({
      ideas: [makeIdea({ id: 'a' }), makeIdea({ id: 'b' })],
      minSupporters: 2,
    });

    await cron.sweep();

    expect(clusterCreateSpy).toHaveBeenCalledTimes(1);
    // embedding записан raw-UPDATE'ом по idea_clusters с приведением ::vector(1536)
    const call = executeRawSpy.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('idea_clusters') &&
        sql.includes('::vector(1536)'),
    );
    expect(call).toBeDefined();
    // первый параметр — векторный литерал mean'а ([0.1,0.2,0.3] для всех)
    expect(call![1]).toBe('[0.1,0.2,0.3]');
  });

  it('на ATTACH к существующему кластеру тоже пересчитывает embedding', async () => {
    const { cron, clusterUpdateSpy, executeRawSpy } = makeCron({
      ideas: [makeIdea({ id: 'x' })],
      nearestByIdea: { x: { id: 'cl_exist', ideaIds: ['old1'] } },
    });

    await cron.sweep();

    expect(clusterUpdateSpy).toHaveBeenCalledTimes(1);
    const call = executeRawSpy.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string' &&
        sql.includes('idea_clusters') &&
        sql.includes('::vector(1536)'),
    );
    expect(call).toBeDefined();
    // целевой clusterId передан в UPDATE
    expect(call![2]).toBe('cl_exist');
  });
});

describe('IdeaClustererCron — Б39: flush хвоста накопителя', () => {
  it('хвост ≥2 при minSupporters=3 → создаёт кластер (не вечный orphan)', async () => {
    // 2 miss-идеи, порог 3 → в основном цикле кластер НЕ создаётся,
    // но финальный flush должен его создать.
    const { cron, clusterCreateSpy } = makeCron({
      ideas: [makeIdea({ id: 't1' }), makeIdea({ id: 't2' })],
      minSupporters: 3,
    });

    await cron.sweep();

    expect(clusterCreateSpy).toHaveBeenCalledTimes(1);
  });

  it('хвост из 1 идеи → кластер НЕ создаётся (нет смысла), сбоя нет', async () => {
    const { cron, clusterCreateSpy } = makeCron({
      ideas: [makeIdea({ id: 'solo' })],
      minSupporters: 2,
    });

    await cron.sweep();

    expect(clusterCreateSpy).not.toHaveBeenCalled();
  });
});
