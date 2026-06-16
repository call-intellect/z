import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import { buildKnowledgeCoreFixture } from '../../../../test/integration/knowledge-core/fixtures';
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
    await expect(ctrl.neighbors(q, userB, f.orgBId)).rejects.toBeInstanceOf(NotFoundException);
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
    await expect(ctrl.neighbors(q, userA, f.orgAId)).rejects.toBeInstanceOf(ForbiddenException);
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
    await expect(ctrl.neighbors(q, userA, undefined)).rejects.toBeInstanceOf(ForbiddenException);
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
    await expect(ctrl.neighbors(q, userA, f.orgAId)).rejects.toBeInstanceOf(NotFoundException);
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
  const partitionSpy = vi.fn(async () => opts.partition ?? { accessible: [], denied: 0 });
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
      findMany: vi.fn(async (args: { where?: { fromBlockId?: string } }) => {
        if (args?.where && 'fromBlockId' in args.where) {
          return [
            {
              fromBlockId: 'B0',
              toBlockId: 'B1',
              relationType: 'supports',
              status: 'active',
              confidence: 0.9,
              toBlock: { id: 'B1', name: 'B1' },
            },
          ];
        }
        return [];
      }),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () => [{ entity: { id: 'E1', canonicalName: 'E1' } }]),
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
    expect(ids).not.toContain('B1');
    expect(ids).toContain('E1');
    const hasBlockLink = res.edges.some((e) => e.type === 'block-link');
    expect(hasBlockLink).toBe(false);
    const hasBlockEntity = res.edges.some((e) => e.type === 'block-entity' && e.to === 'E1');
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
