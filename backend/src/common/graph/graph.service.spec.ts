import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphService } from './graph.service';

interface MockState {
  processCreated: Array<Record<string, unknown>>;
  decisionCreated: Array<Record<string, unknown>>;
  entityLinkUpserted: Array<Record<string, unknown>>;
  cypherCalls: string[];
}

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
    $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(txClient)),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      state.cypherCalls.push(sql);
      if (cypherThrows) {
        throw new Error('function cypher(unknown, unknown) does not exist (42883)');
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
    const mock = buildPrismaMock(true);
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

    expect(state.processCreated).toHaveLength(1);
    expect(state.processCreated[0]).toMatchObject({ name: 'Онбординг' });
    expect(res).toMatchObject({ id: 'process-1', created: true });
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

    expect(state.entityLinkUpserted).toHaveLength(1);
    expect(state.cypherCalls.length).toBeGreaterThan(0);
  });
});

describe('GraphService Ф5 — kill-switch (ageEnabled=false → cypher no-op)', () => {
  it('upsertEntity(process): Postgres пишется, cypher НЕ вызывается', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    const res = await svc.upsertEntity({
      tenantId: 'tenant-1',
      type: 'process',
      data: { name: 'Онбординг' },
    });

    expect(mock.state.processCreated).toHaveLength(1);
    expect(res).toMatchObject({ created: true });
    expect(mock.state.cypherCalls).toHaveLength(0);
    expect(mock.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('addEdge: EntityLink пишется, cypher НЕ вызывается', async () => {
    const mock = buildPrismaMock(false);
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
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    await svc.addNode({ tenantId: 'tenant-1', type: 'role', id: 'r1' });

    expect(mock.state.cypherCalls).toHaveLength(0);
  });
});

describe('GraphService upsertDecision — анти-потеря при @unique sourceIdeaBlockId', () => {
  function p2002SourceIdeaBlock(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { target: ['sourceIdeaBlockId'] },
    });
  }

  it('гонка писателей: create роняет P2002 → re-find того же тенанта → created:false, без throw', async () => {
    const txClient = {
      decision: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw p2002SourceIdeaBlock();
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(txClient)),
      decision: {
        findFirst: vi.fn(async () => ({ id: 'dec-existing' })),
      },
      $queryRawUnsafe: vi.fn(async () => []),
    };
    const svc = new GraphService(prisma as any, buildCfg(true));

    const res = await svc.upsertEntity({
      tenantId: 'tenant-1',
      type: 'decision',
      data: {
        text: 'Решили запускать',
        decidedAt: new Date('2026-06-01T00:00:00.000Z'),
        sourceIdeaBlockId: 'block-1',
      },
    });

    expect(res).toMatchObject({ created: false, id: 'dec-existing' });
    expect(prisma.decision.findFirst).toHaveBeenCalledTimes(1);
  });

  it('cross-tenant: findUnique вернул Decision другого тенанта → ConflictException, create НЕ вызывается', async () => {
    const txClient = {
      decision: {
        findUnique: vi.fn(async () => ({ id: 'x', tenantId: 'other-tenant' })),
        create: vi.fn(async () => ({ id: 'should-not-happen' })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(txClient)),
      decision: {
        findFirst: vi.fn(async () => null),
      },
      $queryRawUnsafe: vi.fn(async () => []),
    };
    const svc = new GraphService(prisma as any, buildCfg(true));

    await expect(
      svc.upsertEntity({
        tenantId: 'tenant-1',
        type: 'decision',
        data: {
          text: 'Решили запускать',
          decidedAt: new Date('2026-06-01T00:00:00.000Z'),
          sourceIdeaBlockId: 'block-1',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txClient.decision.create).not.toHaveBeenCalled();
  });
});

describe('GraphService Ф4-A — graph-only примитивы (только AGE, без записи в Prisma)', () => {
  function sqls(mock: { prisma: { $queryRawUnsafe: ReturnType<typeof vi.fn> } }): string[] {
    return mock.prisma.$queryRawUnsafe.mock.calls.map((c: unknown[]) => c[0] as string);
  }

  it('mergeEdgeGraphOnly: пишет MERGE-ребро в AGE, EntityLink.upsert НЕ вызывается', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(true));

    await svc.mergeEdgeGraphOnly({
      tenantId: 'tenant-1',
      from: { type: 'entity', id: 'e1' },
      to: { type: 'entity', id: 'e2' },
      linkType: 'works_at',
    });

    const calls = sqls(mock);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((sql) => sql.includes('MERGE'))).toBe(true);
    expect(calls.some((sql) => sql.includes('works_at'))).toBe(true);
    expect(calls.some((sql) => sql.includes('tenant_id'))).toBe(true);
    expect(mock.state.entityLinkUpserted).toHaveLength(0);
    expect(mock.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deleteEdgeGraphOnly: пишет DELETE r в AGE', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(true));

    await svc.deleteEdgeGraphOnly({
      tenantId: 'tenant-1',
      from: { type: 'entity', id: 'e1' },
      to: { type: 'entity', id: 'e2' },
      linkType: 'works_at',
    });

    expect(sqls(mock).some((sql) => sql.includes('DELETE r'))).toBe(true);
    expect(mock.state.entityLinkUpserted).toHaveLength(0);
  });

  it('deleteNodeGraphOnly: пишет DETACH DELETE в AGE', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(true));

    await svc.deleteNodeGraphOnly({ tenantId: 'tenant-1', type: 'entity', id: 'e1' });

    expect(sqls(mock).some((sql) => sql.includes('DETACH DELETE'))).toBe(true);
  });

  it('ageEnabled=false: mergeEdgeGraphOnly — no-op, $queryRawUnsafe не вызывается', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(false));

    await svc.mergeEdgeGraphOnly({
      tenantId: 'tenant-1',
      from: { type: 'entity', id: 'e1' },
      to: { type: 'entity', id: 'e2' },
      linkType: 'works_at',
    });

    expect(mock.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('mergeEdgeGraphOnly: неизвестный linkType — бросает, не молчит', async () => {
    const mock = buildPrismaMock(false);
    const svc = new GraphService(mock.prisma, buildCfg(true));

    await expect(
      svc.mergeEdgeGraphOnly({
        tenantId: 'tenant-1',
        from: { type: 'entity', id: 'e1' },
        to: { type: 'entity', id: 'e2' },
        linkType: 'conflicted_with' as never,
      }),
    ).rejects.toThrow();
    expect(mock.prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
