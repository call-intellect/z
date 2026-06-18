/**
 * Integration spec для KnowledgeGraphController (Phase F.2).
 *
 * Реальный Postgres из docker-compose.dev.yml.
 *
 * Покрытие:
 *   - GET /graph/neighbors?nodeType=block — happy path (root block + соседи).
 *   - GET /graph/neighbors?nodeType=entity — happy.
 *   - 403 cross-tenant: запрос узла другой Org → NotFoundException.
 *   - 403 forbidden, 404 not_found, Zod 400 (depth > 3 / неизвестный nodeType).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import { buildKnowledgeCoreFixture } from '../../../../test/integration/knowledge-core/fixtures';
import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type {
  KnowledgeAccessContext,
  KnowledgeAccessResolver,
} from '../../rbac/knowledge-access-resolver.service';
import type { RbacService } from '../../rbac/rbac.service';

import { GraphNeighborsQuerySchema } from './dto/graph.dto';
import { KnowledgeGraphController } from './graph.controller';

const PREFIX = 'kc-graph-spec';

interface Ctx {
  dbReady: boolean;
  ctrl: KnowledgeGraphController | null;
  cleanup: (() => Promise<void>) | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}
const ctx: Ctx = { dbReady: false, ctrl: null, cleanup: null, fixture: null };

function makeRbac(canRead: boolean): RbacService {
  return {
    canRead: async () => canRead,
    canWrite: async () => true,
    check: async () => canRead,
  } as unknown as RbacService;
}

const userA: CurrentUserPayload = {
  id: `${PREFIX}-userA`,
  email: 'a@test',
  role: 'user',
};
const userB: CurrentUserPayload = {
  id: `${PREFIX}-userB`,
  email: 'b@test',
  role: 'user',
};

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  const prisma = await getPrismaClient();
  ctx.fixture = await buildKnowledgeCoreFixture(prisma, PREFIX);
  ctx.cleanup = ctx.fixture.cleanup;
});

afterAll(async () => {
  if (ctx.cleanup) await ctx.cleanup();
  await closePrismaClient();
});

function skipIfNoDb(testCtx: { skip: () => void }): boolean {
  if (!ctx.dbReady) {
    testCtx.skip();
    return true;
  }
  return false;
}

describe('KnowledgeGraphController (integration)', () => {
  it('happy: GET /graph/neighbors?nodeType=block depth=1', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(true));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: f.blockAId,
      depth: 1,
    });
    const res = await ctrl.neighbors(q, userA, f.orgAId);
    expect(res.rootNode.id).toBe(f.blockAId);
    expect(res.rootNode.type).toBe('block');
    // У нашего фикстурного блока должна быть как минимум одна entity-связь
    // (через IdeaBlockEntity → entityA).
    expect(res.nodes.find((n) => n.id === f.entityAId)).toBeDefined();
  });

  it('happy: GET /graph/neighbors?nodeType=entity depth=1', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(true));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'entity',
      id: f.entityAId,
      depth: 1,
    });
    const res = await ctrl.neighbors(q, userA, f.orgAId);
    expect(res.rootNode.id).toBe(f.entityAId);
    expect(res.rootNode.type).toBe('entity');
    // Должен подтянуть блок-mention.
    expect(res.nodes.find((n) => n.id === f.blockAId)).toBeDefined();
  });

  it('403 cross-tenant: узел другой Org → NotFoundException', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(true));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: f.blockAId,
      depth: 1,
    });
    await expect(ctrl.neighbors(q, userB, f.orgBId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 forbidden если canRead=false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(false));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: f.blockAId,
      depth: 1,
    });
    await expect(ctrl.neighbors(q, userA, f.orgAId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 tenant_required (X-Org-Id не передан)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(true));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: f.blockAId,
      depth: 1,
    });
    await expect(ctrl.neighbors(q, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 на несуществующий узел', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeGraphController(prisma, makeRbac(true));

    const q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: `${PREFIX}-no-node`,
      depth: 1,
    });
    await expect(ctrl.neighbors(q, userA, f.orgAId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('Zod-400: depth > 3 отклоняется', () => {
    const r = GraphNeighborsQuerySchema.safeParse({
      nodeType: 'block',
      id: 'x',
      depth: 9,
    });
    expect(r.success).toBe(false);
  });

  it('Zod-400: неизвестный nodeType отклоняется', () => {
    const r = GraphNeighborsQuerySchema.safeParse({
      nodeType: 'phantom',
      id: 'x',
      depth: 1,
    });
    expect(r.success).toBe(false);
  });
});

// ──────────────── Ф4 knowledge-access — гейт BFS-графа (unit) ────────────────
//
// Юнит-тесты (без БД): мокаем prisma/resolver/cfg/metrics. Сценарий: root
// block B0 имеет блок-ссылку на B1 (block-node) и упоминание сущности E1.
// При enforce доступ к B1 отказан → B1-узел и block-link к нему убраны;
// entity-узел E1 НЕ гейтится. Метрики проверяем.

const GATE_USER: CurrentUserPayload = {
  id: 'graph-gate-user',
  email: 'gate@test',
  role: 'user',
};
const TENANT = 'graph-gate-org';

function gateRbac(): RbacService {
  return { canRead: async () => true } as unknown as RbacService;
}

function gateResolver(opts: {
  ctx: KnowledgeAccessContext | null;
  partition?: { accessible: string[]; denied: number };
}): {
  resolver: KnowledgeAccessResolver;
  resolveSpy: ReturnType<typeof vi.fn>;
  partitionSpy: ReturnType<typeof vi.fn>;
} {
  const resolveSpy = vi.fn(async () => opts.ctx);
  const partitionSpy = vi.fn(
    async () => opts.partition ?? { accessible: [], denied: 0 },
  );
  const resolver = {
    resolveAccessibleGroups: resolveSpy,
    partitionBlockIdsByAccess: partitionSpy,
  } as unknown as KnowledgeAccessResolver;
  return { resolver, resolveSpy, partitionSpy };
}

function gateMetrics(): {
  metrics: BusinessMetricsService;
  incDenied: ReturnType<typeof vi.fn>;
  incShadow: ReturnType<typeof vi.fn>;
} {
  const incDenied = vi.fn();
  const incShadow = vi.fn();
  const metrics = {
    incAccessDenied: incDenied,
    incAccessShadowDiff: incShadow,
  } as unknown as BusinessMetricsService;
  return { metrics, incDenied, incShadow };
}

function gateCfg(enf: 'off' | 'shadow' | 'enforce'): TypedConfigService {
  return { knowledgeAccess: { enforcement: enf } } as unknown as TypedConfigService;
}

function graphPrisma(): PrismaService {
  return {
    ideaBlock: {
      findUnique: vi.fn(async () => ({ id: 'B0', name: 'B0', tenantId: TENANT })),
    },
    ideaBlockLink: {
      // G3 (perf) — батч-запрос: один findMany с OR:[{fromBlockId:{in}},…].
      // Ребро B0→B1 (block-link). include обоих концов (toBlock/fromBlock).
      findMany: vi.fn(async () => [
        {
          fromBlockId: 'B0',
          toBlockId: 'B1',
          relationType: 'supports',
          status: 'active',
          confidence: 0.9,
          toBlock: { id: 'B1', name: 'B1' },
          fromBlock: { id: 'B0', name: 'B0' },
        },
      ]),
    },
    ideaBlockEntity: {
      // Батч: blockId:{in}. m.blockId нужен для ребра block-entity.
      findMany: vi.fn(async () => [
        { blockId: 'B0', entityId: 'E1', entity: { id: 'E1', canonicalName: 'E1' } },
      ]),
    },
  } as unknown as PrismaService;
}

describe('KnowledgeGraphController.neighbors — Ф4 гейт (unit)', () => {
  const Q = GraphNeighborsQuerySchema.parse({
    nodeType: 'block',
    id: 'B0',
    depth: 1,
  });

  it('off → resolver не вызывается, B1 и E1 в выдаче', async () => {
    const { resolver, resolveSpy } = gateResolver({ ctx: null });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeGraphController(
      graphPrisma(),
      gateRbac(),
      resolver,
      gateCfg('off'),
      metrics,
    );
    const res = await ctrl.neighbors(Q, GATE_USER, TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toContain('B1');
    expect(ids).toContain('E1');
  });

  it('enforce → недоступный block-узел B1 убран + его ребро + incAccessDenied; E1 остаётся', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver, partitionSpy } = gateResolver({
      ctx,
      // block-узлы [B0, B1]; B0 (root) доступен, B1 — нет.
      partition: { accessible: ['B0'], denied: 1 },
    });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeGraphController(
      graphPrisma(),
      gateRbac(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.neighbors(Q, GATE_USER, TENANT);
    expect(partitionSpy).toHaveBeenCalled();
    const ids = res.nodes.map((n) => n.id);
    expect(ids).not.toContain('B1'); // недоступный block-узел убран
    expect(ids).toContain('E1'); // entity-узел не гейтится
    // block-link B0→B1 удалён (конец B1 отсутствует); block-entity B0→E1 остался.
    const hasBlockLink = res.edges.some((e) => e.type === 'block-link');
    expect(hasBlockLink).toBe(false);
    const hasBlockEntity = res.edges.some(
      (e) => e.type === 'block-entity' && e.to === 'E1',
    );
    expect(hasBlockEntity).toBe(true);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'graph' }, 1);
  });

  it('bypass → partition не вызывается, B1 и E1 в выдаче', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { resolver, partitionSpy } = gateResolver({ ctx });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeGraphController(
      graphPrisma(),
      gateRbac(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.neighbors(Q, GATE_USER, TENANT);
    expect(partitionSpy).not.toHaveBeenCalled();
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toContain('B1');
    expect(ids).toContain('E1');
  });

  it('shadow → выдача не меняется (B1 есть) + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver } = gateResolver({
      ctx,
      partition: { accessible: ['B0'], denied: 1 },
    });
    const { metrics, incShadow, incDenied } = gateMetrics();
    const ctrl = new KnowledgeGraphController(
      graphPrisma(),
      gateRbac(),
      resolver,
      gateCfg('shadow'),
      metrics,
    );
    const res = await ctrl.neighbors(Q, GATE_USER, TENANT);
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toContain('B1');
    expect(ids).toContain('E1');
    expect(incShadow).toHaveBeenCalledWith({ surface: 'graph' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });
});

// ──────────────── G3 (perf): BFS батчит запросы по уровню (unit) ──────────────
//
// Регрессия N+1: раньше каждый block-узел frontier стоил 3 findMany; при
// frontier из N узлов → 3·N последовательных запросов в одном HTTP. Теперь —
// ОДИН findMany на уровень (per тип связи) c `OR:[...{in:[...frontier]}]`.
// Проверяем: (1) число вызовов ideaBlockLink.findMany == число уровней
// (а не число узлов); (2) findMany получает батч `in:[...frontier]`, не
// per-node; (3) семантика обхода (узлы/рёбра/depth) сохранена.

const G3_USER: CurrentUserPayload = {
  id: 'g3-user',
  email: 'g3@test',
  role: 'user',
};
const G3_TENANT = 'g3-org';

/**
 * Mock-граф из block'ов: root B0 → {B1, B2, B3} (уровень 1), каждый из них →
 * один новый сосед (уровень 2). Все рёбра — block-link. Один findMany на
 * IdeaBlockLink обслуживает ВЕСЬ frontier через `OR:[{fromBlockId:{in}},…]`.
 */
function g3BatchPrisma(): {
  prisma: PrismaService;
  linkFindMany: ReturnType<typeof vi.fn>;
  entityFindMany: ReturnType<typeof vi.fn>;
} {
  const adjacency: Record<string, string[]> = {
    B0: ['B1', 'B2', 'B3'],
    B1: ['B1a'],
    B2: ['B2a'],
    B3: ['B3a'],
  };
  const linkFindMany = vi.fn(async (args: { where?: { OR?: unknown[] } }) => {
    // Достаём frontier из OR:[{fromBlockId:{in:[...]}},{toBlockId:{in:[...]}}].
    const or = (args?.where?.OR ?? []) as Array<{
      fromBlockId?: { in?: string[] };
      toBlockId?: { in?: string[] };
    }>;
    const frontier = new Set<string>();
    for (const cond of or) {
      for (const id of cond.fromBlockId?.in ?? []) frontier.add(id);
      for (const id of cond.toBlockId?.in ?? []) frontier.add(id);
    }
    const rows: unknown[] = [];
    for (const src of frontier) {
      for (const dst of adjacency[src] ?? []) {
        rows.push({
          fromBlockId: src,
          toBlockId: dst,
          relationType: 'supports',
          status: 'active',
          confidence: 0.9,
          fromBlock: { id: src, name: src },
          toBlock: { id: dst, name: dst },
        });
      }
    }
    return rows;
  });
  const entityFindMany = vi.fn(async () => []);
  const prisma = {
    ideaBlock: {
      findUnique: vi.fn(async () => ({
        id: 'B0',
        name: 'B0',
        tenantId: G3_TENANT,
      })),
    },
    ideaBlockLink: { findMany: linkFindMany },
    ideaBlockEntity: { findMany: entityFindMany },
  } as unknown as PrismaService;
  return { prisma, linkFindMany, entityFindMany };
}

describe('KnowledgeGraphController.neighbors — G3 батчинг (unit)', () => {
  it('depth=2, frontier из 3 узлов → ОДИН findMany на уровень (не per-node)', async () => {
    const { prisma, linkFindMany, entityFindMany } = g3BatchPrisma();
    const ctrl = new KnowledgeGraphController(prisma, gateRbac());
    const Q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: 'B0',
      depth: 2,
    });

    const res = await ctrl.neighbors(Q, G3_USER, G3_TENANT);

    // 2 уровня → ровно 2 вызова findMany (НЕ 1 + 3 = 4 при per-node N+1).
    expect(linkFindMany).toHaveBeenCalledTimes(2);
    expect(entityFindMany).toHaveBeenCalledTimes(2);

    // Уровень 2 получил БАТЧ всех трёх узлов frontier одним запросом.
    const lvl2Where = linkFindMany.mock.calls[1]![0].where as {
      OR: Array<{ fromBlockId?: { in?: string[] }; toBlockId?: { in?: string[] } }>;
    };
    const batched = new Set<string>();
    for (const cond of lvl2Where.OR) {
      for (const id of cond.fromBlockId?.in ?? []) batched.add(id);
      for (const id of cond.toBlockId?.in ?? []) batched.add(id);
    }
    expect([...batched].sort()).toEqual(['B1', 'B2', 'B3']);

    // Семантика обхода сохранена: все узлы двух уровней + root в выдаче.
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      'B0',
      'B1',
      'B1a',
      'B2',
      'B2a',
      'B3',
      'B3a',
    ]);
    // Глубины проставлены по уровню.
    const byId = new Map(res.nodes.map((n) => [n.id, n.depth]));
    expect(byId.get('B0')).toBe(0);
    expect(byId.get('B1')).toBe(1);
    expect(byId.get('B1a')).toBe(2);
    // 6 block-link рёбер (3 на ур.1 + 3 на ур.2).
    expect(res.edges.filter((e) => e.type === 'block-link')).toHaveLength(6);
  });

  it('число запросов НЕ растёт линейно с числом узлов (батч, не N+1)', async () => {
    const { prisma, linkFindMany } = g3BatchPrisma();
    const ctrl = new KnowledgeGraphController(prisma, gateRbac());
    const Q = GraphNeighborsQuerySchema.parse({
      nodeType: 'block',
      id: 'B0',
      depth: 2,
    });

    const res = await ctrl.neighbors(Q, G3_USER, G3_TENANT);

    // 7 узлов в графе, но запросов по уровням — только 2.
    expect(res.nodes.length).toBe(7);
    expect(linkFindMany.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
