import { describe, expect, it, vi } from 'vitest';

import { ThemeClustererCron } from './theme-clusterer.cron';

/**
 * Аудит-баг Б10 (класс K10, MASTER §3.2/§4) — гард уникальности «блок ↔ Theme».
 *
 * PK ThemeIdeaBlock — (themeId, blockId), т.е. НЕ уникален по blockId: один
 * блок мог попасть в несколько Theme. Между SELECT кандидатов
 * (NOT EXISTS ThemeIdeaBlock) и записью был LLM-вызов classifyTheme — окно, в
 * котором параллельный тик мог забрать блоки. Фикс: внутри транзакции пере-чек
 * `NOT EXISTS ThemeIdeaBlock`, пишем только свободные; если свободных нет —
 * тему не создаём.
 *
 * Тесты детерминированные, Prisma/сервисы замоканы (без БД).
 */

function makeCron(args: {
  /** blockId'ы кластера, которые вернёт ClusteringService. */
  clusterBlockIds: string[];
  /** blockId'ы, которые при re-check внутри tx УЖЕ заняты другой Theme. */
  takenBlockIds: string[];
}) {
  const themeCreateSpy = vi.fn(async () => ({ id: 'theme_new' }));
  const themeIdeaBlockCreateManySpy = vi.fn(
    async (_arg: { data: Array<{ themeId: string; blockId: string }> }) => ({
      count: 0,
    }),
  );
  const themeEntityCreateManySpy = vi.fn(async () => ({ count: 0 }));
  const executeRawSpy = vi.fn(async () => 1);

  const taken = new Set(args.takenBlockIds);

  // tx-объект: re-check свободных блоков + write-методы.
  const txQueryRawUnsafe = vi.fn(
    async (_sql: string, _tenant: string, ids: string[]) =>
      ids.filter((id) => !taken.has(id)).map((id) => ({ id })),
  );
  const tx = {
    $queryRawUnsafe: txQueryRawUnsafe,
    theme: { create: themeCreateSpy },
    themeIdeaBlock: { createMany: themeIdeaBlockCreateManySpy },
    themeEntity: { createMany: themeEntityCreateManySpy },
  };

  // Уровень prisma: count кандидатов, выборка эмбеддингов, блоки, $transaction.
  const candidateCount = args.clusterBlockIds.length;
  const blockRows = args.clusterBlockIds.map((id) => ({
    id,
    embedding: '[0.1,0.2,0.3]',
  }));

  const prismaQueryRawUnsafe = vi.fn(async (sql: string) => {
    if (sql.includes('COUNT(*)')) return [{ count: BigInt(candidateCount) }];
    if (sql.includes('embedding::text')) return blockRows;
    return [];
  });

  const fakePrisma = {
    org: {
      findMany: async () => [{ id: 'org_1' }],
    },
    ideaBlock: {
      findMany: async () =>
        args.clusterBlockIds.map((id) => ({
          id,
          name: `block ${id}`,
          criticalQuestion: 'q',
          trustedAnswer: 'a',
          signalType: 'fact',
          tags: [],
          dataClass: 'internal',
        })),
    },
    ideaBlockEntity: { findMany: async () => [] },
    theme: { create: themeCreateSpy },
    themeIdeaBlock: { createMany: themeIdeaBlockCreateManySpy },
    themeEntity: { createMany: themeEntityCreateManySpy },
    $queryRawUnsafe: prismaQueryRawUnsafe,
    $executeRawUnsafe: executeRawSpy,
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[0];

  const fakeCfg = {
    knowledgeCore: {
      themeClusteringMinBlocks: 1,
      themeClusterMinSize: 1,
      themeCosineThreshold: 0.8,
    },
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[1];

  const fakeClustering = {
    clusterByEmbedding: vi.fn(() => [{ blockIds: args.clusterBlockIds }]),
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[2];

  const fakeClassifier = {
    classifyTheme: vi.fn(async () => ({
      name: 'Тема',
      description: 'Описание',
      branch: null,
      weight: 1,
      confidence: 0.9,
    })),
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[3];

  const fakeEmbeddings = {
    embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[4];

  const fakeGate = {
    checkOrThrow: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof ThemeClustererCron>[5];

  return {
    cron: new ThemeClustererCron(
      fakePrisma,
      fakeCfg,
      fakeClustering,
      fakeClassifier,
      fakeEmbeddings,
      fakeGate,
    ),
    themeCreateSpy,
    themeIdeaBlockCreateManySpy,
    txQueryRawUnsafe,
  };
}

describe('ThemeClustererCron — Б10: блок не дублируется в несколько Theme', () => {
  it('все свободны → Theme создаётся со всеми блоками', async () => {
    const { cron, themeCreateSpy, themeIdeaBlockCreateManySpy } = makeCron({
      clusterBlockIds: ['b1', 'b2'],
      takenBlockIds: [],
    });

    const res = await cron.runForAllOrgs();

    expect(res.createdThemes).toBe(1);
    expect(themeCreateSpy).toHaveBeenCalledTimes(1);
    const data = themeIdeaBlockCreateManySpy.mock.calls[0]![0].data;
    expect(data.map((d) => d.blockId).sort()).toEqual(['b1', 'b2']);
  });

  it('часть блоков уже занята → пишутся ТОЛЬКО свободные', async () => {
    const { cron, themeCreateSpy, themeIdeaBlockCreateManySpy } = makeCron({
      clusterBlockIds: ['b1', 'b2', 'b3'],
      takenBlockIds: ['b2'], // b2 уже в другой Theme
    });

    await cron.runForAllOrgs();

    expect(themeCreateSpy).toHaveBeenCalledTimes(1);
    const data = themeIdeaBlockCreateManySpy.mock.calls[0]![0].data;
    expect(data.map((d) => d.blockId).sort()).toEqual(['b1', 'b3']);
    expect(data.map((d) => d.blockId)).not.toContain('b2');
  });

  it('все блоки уже заняты → Theme НЕ создаётся (нет осиротевшей темы)', async () => {
    const { cron, themeCreateSpy, themeIdeaBlockCreateManySpy } = makeCron({
      clusterBlockIds: ['b1', 'b2'],
      takenBlockIds: ['b1', 'b2'],
    });

    const res = await cron.runForAllOrgs();

    expect(res.createdThemes).toBe(0);
    expect(themeCreateSpy).not.toHaveBeenCalled();
    expect(themeIdeaBlockCreateManySpy).not.toHaveBeenCalled();
  });
});
