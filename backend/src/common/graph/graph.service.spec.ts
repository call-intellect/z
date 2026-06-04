import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphService } from './graph.service';

/**
 * МТЗ «разблокировка конвейера» Ф5 — детерминированные юнит-тесты GraphService
 * БЕЗ живой БД/AGE. Мокаем PrismaService ($transaction + модели) и
 * cypher-исполнитель ($queryRawUnsafe), чтобы доказать:
 *
 *   1. РАЗВЯЗКА ТРАНЗАКЦИИ: при падении cypher() (мок $queryRawUnsafe бросает)
 *      в upsertEntity / upsertDecision / addEdge бизнес-строка ВСЁ РАВНО
 *      записана (prisma.<model>.create / entityLink.upsert вызваны внутри
 *      закоммиченной транзакции), а сам метод НЕ бросает (post-commit
 *      best-effort).
 *   2. KILL-SWITCH: при cfg.graph.ageEnabled=false cypher-исполнитель НЕ
 *      вызывается (no-op), Postgres-часть отрабатывает.
 *
 * Эти тесты — машинный гард на главное свойство Ф5: «отказ AGE не откатывает
 * бизнес-строку». Без живого Postgres+AGE проверяем логику разводки tx, а не
 * реальный cypher (его проверяет интеграция против AGE-контейнера).
 */

interface MockState {
  // Записи, созданные «бизнес-строкой» (Postgres).
  processCreated: Array<Record<string, unknown>>;
  decisionCreated: Array<Record<string, unknown>>;
  entityLinkUpserted: Array<Record<string, unknown>>;
  // Вызовы cypher-исполнителя (raw SQL).
  cypherCalls: string[];
}

/**
 * Строит мок PrismaService. `cypherThrows` — заставляет $queryRawUnsafe
 * (cypher-исполнитель) бросать, имитируя недоступность AGE.
 */
function buildPrismaMock(cypherThrows: boolean): {
  prisma: any;
  state: MockState;
} {
  const state: MockState = {
    processCreated: [],
    decisionCreated: [],
    entityLinkUpserted: [],
    cypherCalls: [],
  };

  let processSeq = 0;
  let decisionSeq = 0;

  const txClient = {
    process: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        processSeq += 1;
        const id = `process-${processSeq}`;
        state.processCreated.push(args.data);
        return { id };
      }),
    },
    decision: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        decisionSeq += 1;
        const id = `decision-${decisionSeq}`;
        state.decisionCreated.push(args.data);
        return { id };
      }),
    },
    entityLink: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        state.entityLinkUpserted.push(args);
        return { id: 'link-1' };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const prisma = {
    // $transaction(cb) — синхронно прогоняет колбэк с tx-клиентом и
    // «коммитит» (просто резолвит). Бизнес-строка фиксируется ДО cypher.
    $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) =>
      cb(txClient),
    ),
    // cypher-исполнитель (runRawCypher / runCypherMergeNode идут сюда).
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      state.cypherCalls.push(sql);
      if (cypherThrows) {
        throw new Error(
          'function cypher(unknown, unknown) does not exist (42883)',
        );
      }
      return [];
    }),
  };

  return { prisma, state };
}

function buildCfg(ageEnabled: boolean): any {
  return { graph: { ageEnabled } };
}

describe('GraphService Ф5 — развязка транзакции (cypher падает)', () => {
  let state: MockState;
  let svc: GraphService;

  beforeEach(() => {
    const mock = buildPrismaMock(/* cypherThrows */ true);
    state = mock.state;
    svc = new GraphService(mock.prisma, buildCfg(true));
  });

  it('upsertEntity(process): бизнес-строка записана, метод не бросает несмотря на падение cypher', async () => {
    const res = await svc.upsertEntity({
      tenantId: 'tenant-1',
      type: 'process',
      data: { name: 'Онбординг' },
      confidence: 0.9,
    });

    // Бизнес-строка создана и закоммичена ДО cypher.
    expect(state.processCreated).toHaveLength(1);
    expect(state.processCreated[0]).toMatchObject({ name: 'Онбординг' });
    expect(res).toMatchObject({ id: 'process-1', created: true });
    // cypher вызывался (post-commit) и бросил — но метод выжил.
    expect(state.cypherCalls.length).toBeGreaterThan(0);
  });

  it('upsertDecision: Decision записан, метод не бросает несмотря на падение cypher', async () => {
    const res = await svc.upsertEntity({
      tenantId: 'tenant-1',
      type: 'decision',
      data: {
        text: 'Решили запускать',
        decidedAt: new Date('2026-06-01T00:00:00.000Z'),
        sourceIdeaBlockId: 'block-1',
      },
    });

    expect(state.decisionCreated).toHaveLength(1);
    expect(state.decisionCreated[0]).toMatchObject({ text: 'Решили запускать' });
    expect(res).toMatchObject({ id: 'decision-1', created: true });
    expect(state.cypherCalls.length).toBeGreaterThan(0);
  });

  it('addEdge: EntityLink записан, метод не бросает несмотря на падение cypher', async () => {
    await expect(
      svc.addEdge({
        tenantId: 'tenant-1',
        from: { type: 'person', id: 'p1' },
        to: { type: 'role', id: 'r1' },
        linkType: 'executes_role',
      }),
    ).resolves.toBeUndefined();

    // EntityLink (источник правды) записан внутри коммита tx.
    expect(state.entityLinkUpserted).toHaveLength(1);
    // cypher (merge узлов + merge ребра) вызывался post-commit и упал.
    expect(state.cypherCalls.length).toBeGreaterThan(0);
  });
});

describe('GraphService Ф5 — kill-switch (ageEnabled=false → cypher no-op)', () => {
  it('upsertEntity(process): Postgres пишется, cypher НЕ вызывается', async () => {
    const mock = buildPrismaMock(/* cypherThrows */ false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    const res = await svc.upsertEntity({
      tenantId: 'tenant-1',
      type: 'process',
      data: { name: 'Онбординг' },
    });

    expect(mock.state.processCreated).toHaveLength(1);
    expect(res).toMatchObject({ created: true });
    // Главное: ни одного cypher-вызова.
    expect(mock.state.cypherCalls).toHaveLength(0);
    expect(mock.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('addEdge: EntityLink пишется, cypher НЕ вызывается', async () => {
    const mock = buildPrismaMock(/* cypherThrows */ false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    await svc.addEdge({
      tenantId: 'tenant-1',
      from: { type: 'person', id: 'p1' },
      to: { type: 'role', id: 'r1' },
      linkType: 'executes_role',
    });

    expect(mock.state.entityLinkUpserted).toHaveLength(1);
    expect(mock.state.cypherCalls).toHaveLength(0);
  });

  it('addNode: при ageEnabled=false — полный no-op (cypher не вызывается)', async () => {
    const mock = buildPrismaMock(/* cypherThrows */ false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    await svc.addNode({ tenantId: 'tenant-1', type: 'role', id: 'r1' });

    expect(mock.state.cypherCalls).toHaveLength(0);
  });
});
