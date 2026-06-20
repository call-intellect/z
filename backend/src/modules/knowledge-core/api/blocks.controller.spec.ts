import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import {
  checkDbAvailable,
  checkPgvectorAvailable,
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
import type { ProvenanceService } from '../services/provenance.service';
import type { ReasoningChainService } from '../services/reasoning-chain.service';

import { KnowledgeBlocksController } from './blocks.controller';

const PREFIX = 'kc-blocks-spec';

interface Ctx {
  dbReady: boolean;
  pgvectorReady: boolean;
  ctrl: KnowledgeBlocksController | null;
  cleanup: (() => Promise<void>) | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}

const ctx: Ctx = {
  dbReady: false,
  pgvectorReady: false,
  ctrl: null,
  cleanup: null,
  fixture: null,
};

function makeRbacAllowAll(): RbacService {
  return {
    canRead: async () => true,
    canWrite: async () => true,
    check: async () => true,
  } as unknown as RbacService;
}

function makeRbacDeny(): RbacService {
  return {
    canRead: async () => false,
    canWrite: async () => false,
    check: async () => false,
  } as unknown as RbacService;
}

function makeReasoningChainStub(): ReasoningChainService {
  return {
    buildChain: async () => ({ nodes: [], edges: [] }),
  } as unknown as ReasoningChainService;
}

function makeProvenanceStub(): ProvenanceService {
  return {
    resolveByRawEventIds: async () => new Map(),
  } as unknown as ProvenanceService;
}

const userA: CurrentUserPayload = {
  id: `${PREFIX}-userA`,
  email: 'ownera@test.local',
  role: 'user',
};
const userB: CurrentUserPayload = {
  id: `${PREFIX}-userB`,
  email: 'ownerb@test.local',
  role: 'user',
};

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  ctx.pgvectorReady = await checkPgvectorAvailable();
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

describe('KnowledgeBlocksController (integration)', () => {
  it('happy: GET /blocks/:id возвращает блок + evidence + entities', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    const res = await ctrl.byId(f.blockAId, userA, f.orgAId);
    expect(res.block.id).toBe(f.blockAId);
    expect(res.block.signalType).toBe('fact');
    expect(res.evidence.length).toBeGreaterThanOrEqual(1);
    expect(res.entities[0]?.id).toBe(f.entityAId);
  });

  it('403 cross-tenant: блок другой Org → NotFoundException (tenant fence)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    await expect(ctrl.byId(f.blockAId, userB, f.orgBId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 forbidden если RBAC.canRead вернул false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacDeny(), makeReasoningChainStub(), makeProvenanceStub());

    await expect(ctrl.byId(f.blockAId, userA, f.orgAId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 tenant_required если X-Org-Id не передан', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    await expect(ctrl.byId(f.blockAId, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 на несуществующий blockId', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    await expect(ctrl.byId(`${PREFIX}-missing-block`, userA, f.orgAId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('GET /blocks/:id/links возвращает outgoing+incoming (пустые при отсутствии связей)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    const res = await ctrl.links(f.blockAId, userA, f.orgAId);
    expect(Array.isArray(res.outgoing)).toBe(true);
    expect(Array.isArray(res.incoming)).toBe(true);
  });

  it('GET /blocks/:id/links для блока другой Org → NotFoundException', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(
      prisma,
      makeRbacAllowAll(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
    );

    await expect(ctrl.links(f.blockAId, userB, f.orgBId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

const GATE_USER: CurrentUserPayload = {
  id: 'blk-gate-user',
  email: 'gate@test',
  role: 'user',
};
const GATE_TENANT = 'blk-gate-org';

function gateRbac(): RbacService {
  return {
    canRead: async () => true,
    canWrite: async () => true,
    canAccessKnowledgeGroup: (
      c: KnowledgeAccessContext,
      blockGroups: Array<{ groupId: string; isClosed: boolean; kind: string }>,
    ): boolean => {
      if (c.isBypass) return true;
      const closed = blockGroups.filter((g) => g.isClosed);
      if (closed.length > 0) {
        return closed.every((g) => c.closedGroupIds.includes(g.groupId));
      }
      const dept = blockGroups.filter((g) => g.kind === 'department');
      if (dept.length === 0) return true;
      return dept.some((g) => c.deptGroupIds.includes(g.groupId));
    },
  } as unknown as RbacService;
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

function gateResolver(opts: {
  ctx: KnowledgeAccessContext | null;
  blockGroups?: Map<string, Array<{ groupId: string; isClosed: boolean; kind: string }>>;
}): {
  resolver: KnowledgeAccessResolver;
  resolveSpy: ReturnType<typeof vi.fn>;
  loadSpy: ReturnType<typeof vi.fn>;
  partitionSpy: ReturnType<typeof vi.fn>;
  buildWhereSpy: ReturnType<typeof vi.fn>;
} {
  const groups = opts.blockGroups ?? new Map();
  const ctxVal = opts.ctx;
  const canAccess = (
    c: KnowledgeAccessContext,
    g: Array<{ groupId: string; isClosed: boolean; kind: string }>,
  ): boolean => {
    if (c.isBypass) return true;
    const closed = g.filter((x) => x.isClosed);
    if (closed.length > 0) return closed.every((x) => c.closedGroupIds.includes(x.groupId));
    const dept = g.filter((x) => x.kind === 'department');
    if (dept.length === 0) return true;
    return dept.some((x) => c.deptGroupIds.includes(x.groupId));
  };
  const resolveSpy = vi.fn(async () => ctxVal);
  const loadSpy = vi.fn(async (ids: string[]) => {
    const m = new Map<string, Array<{ groupId: string; isClosed: boolean; kind: string }>>();
    for (const id of ids) m.set(id, groups.get(id) ?? []);
    return m;
  });
  const partitionSpy = vi.fn(async (c: KnowledgeAccessContext, ids: string[]) => {
    const accessible: string[] = [];
    let denied = 0;
    for (const id of ids) {
      if (canAccess(c, groups.get(id) ?? [])) accessible.push(id);
      else denied++;
    }
    return { accessible, denied };
  });
  const buildWhereSpy = vi.fn(() => ({ __accessWhere: true }));
  const resolver = {
    resolveAccessibleGroups: resolveSpy,
    loadBlockAccessGroups: loadSpy,
    partitionBlockIdsByAccess: partitionSpy,
    buildAccessWhere: buildWhereSpy,
  } as unknown as KnowledgeAccessResolver;
  return { resolver, resolveSpy, loadSpy, partitionSpy, buildWhereSpy };
}

function byIdPrisma(blockId: string): PrismaService {
  return {
    ideaBlock: {
      findUnique: vi.fn(async () => ({
        id: blockId,
        tenantId: GATE_TENANT,
        name: 'B',
        criticalQuestion: 'q',
        trustedAnswer: 'secret',
        tags: [] as string[],
        signalType: 'fact',
        confidence: 0.9,
        evidenceCount: 1,
        status: 'canonical',
        mergedIntoId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: vi.fn(async () => []),
    },
    ideaBlockEvidence: { findMany: vi.fn(async () => []) },
    ideaBlockEntity: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;
}

describe('KnowledgeBlocksController.byId — Ф4 гейт (unit)', () => {
  it('off → resolver не вызывается, блок отдаётся', async () => {
    const { resolver, resolveSpy } = gateResolver({ ctx: null });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      byIdPrisma('b1'),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('off'),
      metrics,
    );
    const res = await ctrl.byId('b1', GATE_USER, GATE_TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(res.block.id).toBe('b1');
  });

  it('enforce + недоступный блок → NotFound (block_not_found)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      byIdPrisma('b1'),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    await expect(ctrl.byId('b1', GATE_USER, GATE_TENANT)).rejects.toBeInstanceOf(NotFoundException);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'blocks' }, 1);
  });

  it('bypass → блок отдаётся (даже если он в закрытой группе)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver, loadSpy } = gateResolver({ ctx, blockGroups });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      byIdPrisma('b1'),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.byId('b1', GATE_USER, GATE_TENANT);
    expect(res.block.id).toBe('b1');
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('shadow + недоступный блок → блок отдаётся + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incShadow, incDenied } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      byIdPrisma('b1'),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('shadow'),
      metrics,
    );
    const res = await ctrl.byId('b1', GATE_USER, GATE_TENANT);
    expect(res.block.id).toBe('b1');
    expect(incShadow).toHaveBeenCalledWith({ surface: 'blocks' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });

  it('enforce + доступный блок (своя dept-группа) → блок отдаётся', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: ['g-logistics'],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-logistics', isClosed: false, kind: 'department' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      byIdPrisma('b1'),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.byId('b1', GATE_USER, GATE_TENANT);
    expect(res.block.id).toBe('b1');
    expect(incDenied).not.toHaveBeenCalled();
  });
});

function linksPrisma(): PrismaService {
  return {
    ideaBlock: {
      findUnique: vi.fn(async () => ({ id: 'b1', tenantId: GATE_TENANT })),
    },
    ideaBlockLink: {
      findMany: vi.fn(async (args: { where?: { fromBlockId?: string } }) => {
        if (args?.where?.fromBlockId === 'b1') {
          return [
            {
              id: 'l-out',
              fromBlockId: 'b1',
              toBlockId: 'b2',
              relationType: 'develops',
              confidence: 0.9,
              explanation: null,
              status: 'active',
              createdBy: 'sys',
              createdAt: new Date(),
              toBlock: {
                id: 'b2',
                name: 'B2',
                criticalQuestion: 'q2',
                signalType: 'fact',
              },
            },
          ];
        }
        return [
          {
            id: 'l-in',
            fromBlockId: 'b3',
            toBlockId: 'b1',
            relationType: 'causes',
            confidence: 0.8,
            explanation: null,
            status: 'active',
            createdBy: 'sys',
            createdAt: new Date(),
            fromBlock: {
              id: 'b3',
              name: 'B3',
              criticalQuestion: 'q3',
              signalType: 'fact',
            },
          },
        ];
      }),
    },
  } as unknown as PrismaService;
}

describe('KnowledgeBlocksController.links — Ф4 гейт (unit)', () => {
  it('off → resolver не вызывается, обе связи', async () => {
    const { resolver, resolveSpy } = gateResolver({ ctx: null });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      linksPrisma(),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('off'),
      metrics,
    );
    const res = await ctrl.links('b1', GATE_USER, GATE_TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(res.outgoing.map((l) => l.toBlockId)).toEqual(['b2']);
    expect(res.incoming.map((l) => l.fromBlockId)).toEqual(['b3']);
  });

  it('enforce → связь с недоступным соседом отфильтрована + incAccessDenied', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: ['g-logistics'],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b2', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
      ['b3', [{ groupId: 'g-logistics', isClosed: false, kind: 'department' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      linksPrisma(),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.links('b1', GATE_USER, GATE_TENANT);
    expect(res.outgoing).toEqual([]);
    expect(res.incoming.map((l) => l.fromBlockId)).toEqual(['b3']);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'blocks' }, 1);
  });

  it('shadow → выдача не меняется + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: ['g-logistics'],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b2', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
      ['b3', [{ groupId: 'g-logistics', isClosed: false, kind: 'department' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incShadow, incDenied } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      linksPrisma(),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('shadow'),
      metrics,
    );
    const res = await ctrl.links('b1', GATE_USER, GATE_TENANT);
    expect(res.outgoing.map((l) => l.toBlockId)).toEqual(['b2']);
    expect(res.incoming.map((l) => l.fromBlockId)).toEqual(['b3']);
    expect(incShadow).toHaveBeenCalledWith({ surface: 'blocks' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });

  it('enforce + недоступный ROOT → NotFound', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeBlocksController(
      linksPrisma(),
      gateRbac(),
      makeReasoningChainStub(),
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    await expect(ctrl.links('b1', GATE_USER, GATE_TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

function chainPrisma(): PrismaService {
  return {
    ideaBlock: {
      findUnique: vi.fn(async () => ({ id: 'b1', tenantId: GATE_TENANT })),
    },
  } as unknown as PrismaService;
}

function chainStub(): {
  svc: ReasoningChainService;
  buildSpy: ReturnType<typeof vi.fn>;
} {
  const buildSpy = vi.fn(async () => ({ nodes: [], edges: [] }));
  const svc = { buildChain: buildSpy } as unknown as ReasoningChainService;
  return { svc, buildSpy };
}

describe('KnowledgeBlocksController.reasoningChain — Ф4 гейт (unit)', () => {
  it('off → buildChain без accessWhere (undefined)', async () => {
    const { resolver, resolveSpy, buildWhereSpy } = gateResolver({ ctx: null });
    const { metrics } = gateMetrics();
    const { svc, buildSpy } = chainStub();
    const ctrl = new KnowledgeBlocksController(
      chainPrisma(),
      gateRbac(),
      svc,
      makeProvenanceStub(),
      resolver,
      gateCfg('off'),
      metrics,
    );
    await ctrl.reasoningChainEndpoint('b1', {}, GATE_USER, GATE_TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(buildWhereSpy).not.toHaveBeenCalled();
    expect(buildSpy).toHaveBeenCalledWith('b1', 2, undefined);
  });

  it('enforce + доступный root → buildChain с accessWhere', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver, buildWhereSpy } = gateResolver({ ctx, blockGroups: new Map() });
    const { metrics } = gateMetrics();
    const { svc, buildSpy } = chainStub();
    const ctrl = new KnowledgeBlocksController(
      chainPrisma(),
      gateRbac(),
      svc,
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    await ctrl.reasoningChainEndpoint('b1', {}, GATE_USER, GATE_TENANT);
    expect(buildWhereSpy).toHaveBeenCalledWith(ctx);
    expect(buildSpy).toHaveBeenCalledWith(
      'b1',
      2,
      expect.objectContaining({ __accessWhere: true }),
    );
  });

  it('enforce + недоступный root → NotFound (buildChain не вызывается)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver } = gateResolver({ ctx, blockGroups });
    const { metrics, incDenied } = gateMetrics();
    const { svc, buildSpy } = chainStub();
    const ctrl = new KnowledgeBlocksController(
      chainPrisma(),
      gateRbac(),
      svc,
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    await expect(
      ctrl.reasoningChainEndpoint('b1', {}, GATE_USER, GATE_TENANT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(incDenied).toHaveBeenCalledWith({ surface: 'blocks' }, 1);
  });

  it('bypass → buildChain без accessWhere', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const blockGroups = new Map([
      ['b1', [{ groupId: 'g-council', isClosed: true, kind: 'council' }]],
    ]);
    const { resolver, buildWhereSpy } = gateResolver({ ctx, blockGroups });
    const { metrics } = gateMetrics();
    const { svc, buildSpy } = chainStub();
    const ctrl = new KnowledgeBlocksController(
      chainPrisma(),
      gateRbac(),
      svc,
      makeProvenanceStub(),
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    await ctrl.reasoningChainEndpoint('b1', {}, GATE_USER, GATE_TENANT);
    expect(buildWhereSpy).toHaveBeenCalledWith(ctx);
    expect(buildSpy).toHaveBeenCalled();
  });
});
