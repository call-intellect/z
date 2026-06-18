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

import { ListEntitiesQuerySchema } from './dto/entity.dto';
import { EntityGraphQuerySchema } from './dto/graph.dto';
import { KnowledgeEntitiesController } from './entities.controller';

const PREFIX = 'kc-entities-spec';

interface Ctx {
  dbReady: boolean;
  ctrl: KnowledgeEntitiesController | null;
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

describe('KnowledgeEntitiesController (integration)', () => {
  it('happy: GET /entities возвращает сущности Org', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    const q = ListEntitiesQuerySchema.parse({});
    const res = await ctrl.list(q, userA, f.orgAId);
    expect(res.items.some((e) => e.id === f.entityAId)).toBe(true);
  });

  it('GET /entities для другой Org не возвращает чужие сущности', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    const q = ListEntitiesQuerySchema.parse({});
    const res = await ctrl.list(q, userB, f.orgBId);
    expect(res.items.find((e) => e.id === f.entityAId)).toBeUndefined();
  });

  it('happy: GET /entities/:id возвращает сущность + блоки', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    const res = await ctrl.byId(f.entityAId, userA, f.orgAId);
    expect(res.entity.id).toBe(f.entityAId);
    expect(res.blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('403 cross-tenant: сущность другой Org → NotFoundException', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    await expect(ctrl.byId(f.entityAId, userB, f.orgBId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 forbidden если canRead=false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(false));

    await expect(ctrl.byId(f.entityAId, userA, f.orgAId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 tenant_required (X-Org-Id не передан)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    await expect(ctrl.byId(f.entityAId, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 на несуществующую сущность', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    await expect(ctrl.byId(`${PREFIX}-no-entity`, userA, f.orgAId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('GET /entities/:id/links — outgoing + incoming (пустые для изолированной сущности)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    const res = await ctrl.links(f.entityAId, userA, f.orgAId);
    expect(Array.isArray(res.outgoing)).toBe(true);
    expect(Array.isArray(res.incoming)).toBe(true);
  });

  it('Zod-400 на limit > 100', () => {
    const r = ListEntitiesQuerySchema.safeParse({ limit: 999 });
    expect(r.success).toBe(false);
  });
});

const GATE_USER: CurrentUserPayload = {
  id: 'ent-gate-user',
  email: 'gate@test',
  role: 'user',
};
const TENANT = 'ent-gate-org';

function gateRbac(): RbacService {
  return { canRead: async () => true, canWrite: async () => true } as unknown as RbacService;
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

function mentionPrisma(blockIds: string[]): PrismaService {
  return {
    entity: {
      findUnique: vi.fn(async () => ({
        id: 'e-1',
        tenantId: TENANT,
        type: 'project',
        canonicalName: 'E1',
        aliases: [] as string[],
        mentionsCount: 1,
        metadata: null,
        mergedIntoId: null,
      })),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () =>
        blockIds.map((id) => ({
          block: {
            id,
            name: `block ${id}`,
            criticalQuestion: 'q',
            trustedAnswer: 'a',
            tags: [] as string[],
            signalType: 'fact',
            confidence: 0.9,
            evidenceCount: 1,
            status: 'canonical',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })),
      ),
    },
  } as unknown as PrismaService;
}

describe('KnowledgeEntitiesController.byId — Ф4 гейт (unit)', () => {
  const NOCTX: KnowledgeAccessContext | null = null;

  it('off → resolver не вызывается, все блоки', async () => {
    const { resolver, resolveSpy } = gateResolver({ ctx: NOCTX });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      mentionPrisma(['b1', 'b2']),
      gateRbac(),
      null,
      resolver,
      gateCfg('off'),
      metrics,
    );
    const res = await ctrl.byId('e-1', GATE_USER, TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('enforce → недоступный блок исключён + incAccessDenied', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver, partitionSpy } = gateResolver({
      ctx,
      partition: { accessible: ['b1'], denied: 1 },
    });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      mentionPrisma(['b1', 'b2']),
      gateRbac(),
      null,
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.byId('e-1', GATE_USER, TENANT);
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ['b1', 'b2']);
    expect(res.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'entities' }, 1);
  });

  it('bypass → все блоки (partition не вызывается)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { resolver, partitionSpy } = gateResolver({ ctx });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      mentionPrisma(['b1', 'b2']),
      gateRbac(),
      null,
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.byId('e-1', GATE_USER, TENANT);
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('shadow → выдача не меняется + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver } = gateResolver({
      ctx,
      partition: { accessible: ['b1'], denied: 1 },
    });
    const { metrics, incShadow, incDenied } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      mentionPrisma(['b1', 'b2']),
      gateRbac(),
      null,
      resolver,
      gateCfg('shadow'),
      metrics,
    );
    const res = await ctrl.byId('e-1', GATE_USER, TENANT);
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(incShadow).toHaveBeenCalledWith({ surface: 'entities' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });
});

function graphPrisma(): PrismaService {
  const center = {
    id: 'E0',
    type: 'project',
    canonicalName: 'E0',
    tenantId: TENANT,
  };
  const links = [
    {
      id: 'edgeAB',
      fromEntityId: 'E0',
      toEntityId: 'E1',
      relationType: 'relates',
      confidence: 0.9,
      attributes: null,
      validFrom: new Date(),
      validUntil: null,
      sourceBlockIds: ['b1'],
      fromType: 'entity',
      toType: 'entity',
    },
    {
      id: 'edgeAC',
      fromEntityId: 'E0',
      toEntityId: 'E2',
      relationType: 'relates',
      confidence: 0.9,
      attributes: null,
      validFrom: new Date(),
      validUntil: null,
      sourceBlockIds: ['b2'],
      fromType: 'entity',
      toType: 'entity',
    },
  ];
  const peers = [
    { id: 'E1', type: 'project', canonicalName: 'E1' },
    { id: 'E2', type: 'project', canonicalName: 'E2' },
  ];
  const blocks = [
    { id: 'b1', name: 'B1', trustedAnswer: 'secret', createdAt: new Date(), evidence: [] },
    { id: 'b2', name: 'B2', trustedAnswer: 'public', createdAt: new Date(), evidence: [] },
  ];
  let entityFindManyCall = 0;
  let linkFindManyCall = 0;
  return {
    entity: {
      findUnique: vi.fn(async () => center),
      findMany: vi.fn(async () => {
        entityFindManyCall += 1;
        return entityFindManyCall === 1 ? peers : [];
      }),
    },
    entityLink: {
      findMany: vi.fn(async (args: { where?: { id?: unknown } }) => {
        linkFindManyCall += 1;
        if (args?.where && 'id' in args.where) {
          return links.map((l) => ({ id: l.id, sourceBlockIds: l.sourceBlockIds }));
        }
        return linkFindManyCall === 1 ? links : [];
      }),
    },
    ideaBlock: { findMany: vi.fn(async () => blocks) },
  } as unknown as PrismaService;
}

describe('KnowledgeEntitiesController.getGraph — Ф4 гейт (unit)', () => {
  const QUERY = EntityGraphQuerySchema.parse({ depth: 1 });

  it('off → все рёбра и evidence обоих блоков', async () => {
    const { resolver, resolveSpy } = gateResolver({ ctx: null });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      graphPrisma(),
      gateRbac(),
      null,
      resolver,
      gateCfg('off'),
      metrics,
    );
    const res = await ctrl.getGraph('E0', QUERY, GATE_USER, TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    const edgeIds = res.edges.map((e) => e.edgeId).sort();
    expect(edgeIds).toEqual(['edgeAB', 'edgeAC']);
    const allEvidenceBlockIds = res.edges.flatMap((e) => e.evidence.map((ev) => ev.blockId)).sort();
    expect(allEvidenceBlockIds).toEqual(['b1', 'b2']);
  });

  it('enforce → ребро с недоступным блоком удалено + узел осиротевший убран + incAccessDenied', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver } = gateResolver({
      ctx,
      partition: { accessible: ['b2'], denied: 1 },
    });
    const { metrics, incDenied } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      graphPrisma(),
      gateRbac(),
      null,
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.getGraph('E0', QUERY, GATE_USER, TENANT);
    expect(res.edges.map((e) => e.edgeId)).toEqual(['edgeAC']);
    const allEvidenceBlockIds = res.edges.flatMap((e) => e.evidence.map((ev) => ev.blockId));
    expect(allEvidenceBlockIds).toEqual(['b2']);
    const nodeIds = res.nodes.map((n) => n.id).sort();
    expect(nodeIds).toContain('E0');
    expect(nodeIds).toContain('E2');
    expect(nodeIds).not.toContain('E1');
    expect(incDenied).toHaveBeenCalledWith({ surface: 'entities' }, 1);
  });

  it('bypass → все рёбра, evidence обоих блоков', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { resolver, partitionSpy } = gateResolver({ ctx });
    const { metrics } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      graphPrisma(),
      gateRbac(),
      null,
      resolver,
      gateCfg('enforce'),
      metrics,
    );
    const res = await ctrl.getGraph('E0', QUERY, GATE_USER, TENANT);
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(res.edges.map((e) => e.edgeId).sort()).toEqual(['edgeAB', 'edgeAC']);
  });

  it('shadow → выдача не меняется + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { resolver } = gateResolver({
      ctx,
      partition: { accessible: ['b2'], denied: 1 },
    });
    const { metrics, incShadow, incDenied } = gateMetrics();
    const ctrl = new KnowledgeEntitiesController(
      graphPrisma(),
      gateRbac(),
      null,
      resolver,
      gateCfg('shadow'),
      metrics,
    );
    const res = await ctrl.getGraph('E0', QUERY, GATE_USER, TENANT);
    expect(res.edges.map((e) => e.edgeId).sort()).toEqual(['edgeAB', 'edgeAC']);
    const allEvidenceBlockIds = res.edges.flatMap((e) => e.evidence.map((ev) => ev.blockId)).sort();
    expect(allEvidenceBlockIds).toEqual(['b1', 'b2']);
    expect(incShadow).toHaveBeenCalledWith({ surface: 'entities' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });
});
