import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

import { ListThemesQuerySchema, SaveThemeAsCardSchema } from './dto/theme.dto';
import { KnowledgeThemesController } from './themes.controller';

const PREFIX = 'kc-themes-spec';

interface Ctx {
  dbReady: boolean;
  ctrl: KnowledgeThemesController | null;
  cleanup: (() => Promise<void>) | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}
const ctx: Ctx = { dbReady: false, ctrl: null, cleanup: null, fixture: null };

function makeRbac(canRead: boolean, canWrite = true): RbacService {
  return {
    canRead: async () => canRead,
    canWrite: async () => canWrite,
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

describe('KnowledgeThemesController (integration)', () => {
  it('happy: GET /themes возвращает темы Org', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    const q = ListThemesQuerySchema.parse({});
    const res = await ctrl.list(q, userA, f.orgAId);
    expect(res.items.some((t) => t.id === f.themeAId)).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /themes другой Org возвращает свои темы, не чужие', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    const q = ListThemesQuerySchema.parse({});
    const res = await ctrl.list(q, userB, f.orgBId);
    expect(res.items.find((t) => t.id === f.themeAId)).toBeUndefined();
  });

  it('happy: GET /themes/:id возвращает тему с блоками + сущностями', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    const res = await ctrl.byId(f.themeAId, userA, f.orgAId);
    expect(res.theme.id).toBe(f.themeAId);
    expect(res.blocks.length).toBeGreaterThanOrEqual(1);
    expect(res.entities[0]?.id).toBe(f.entityAId);
  });

  it('403 cross-tenant: тема другой Org → NotFoundException', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    await expect(ctrl.byId(f.themeAId, userB, f.orgBId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 forbidden если canRead=false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(false));

    await expect(ctrl.byId(f.themeAId, userA, f.orgAId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 tenant_required (X-Org-Id не передан)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    await expect(ctrl.byId(f.themeAId, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 на несуществующую тему', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true));

    await expect(ctrl.byId(`${PREFIX}-no-theme`, userA, f.orgAId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('Zod-400 на невалидный list-query (limit > 100)', () => {
    const r = ListThemesQuerySchema.safeParse({ limit: 9999 });
    expect(r.success).toBe(false);
  });

  it('POST /themes/:id/save-as-card создаёт card kind=topic и возвращает bornFromThemeId', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true, true));

    const body = SaveThemeAsCardSchema.parse({
      name: `${PREFIX}-card-name`,
    });
    const res = await ctrl.saveAsCard(f.themeAId, body, userA, f.orgAId);
    expect(res.kind).toBe('topic');
    expect(res.bornFromThemeId).toBe(f.themeAId);
    expect(res.cardId).toBeDefined();

    await prisma.card.delete({ where: { id: res.cardId } }).catch(() => undefined);
  });

  it('POST /themes/:id/save-as-card 403 cross-tenant', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true, true));

    await expect(
      ctrl.saveAsCard(f.themeAId, { name: `${PREFIX}-no` }, userB, f.orgBId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(SaveThemeAsCardSchema.safeParse({ name: '' }).success).toBe(false);

    expect(BadRequestException).toBeDefined();
  });
});

const GATE_USER: CurrentUserPayload = {
  id: 'theme-gate-user',
  email: 'gate@test',
  role: 'user',
};
const TENANT = 'theme-gate-org';

interface ThemeBlockRow {
  block: { id: string } & Record<string, unknown>;
}

function mkBlock(id: string): ThemeBlockRow {
  return {
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
  };
}

function buildGateThemes(opts: {
  enforcement: 'off' | 'shadow' | 'enforce';
  blockRows: ThemeBlockRow[];
  ctx: KnowledgeAccessContext | null;
  partition?: { accessible: string[]; denied: number };
}): {
  ctrl: KnowledgeThemesController;
  resolveSpy: ReturnType<typeof vi.fn>;
  partitionSpy: ReturnType<typeof vi.fn>;
  incDenied: ReturnType<typeof vi.fn>;
  incShadow: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    theme: {
      findUnique: vi.fn(async () => ({
        id: 't-1',
        tenantId: TENANT,
        name: 'Theme',
        description: '',
        branch: null,
        status: 'active',
        origin: 'auto',
        visibility: 'team',
        createdByUserId: null,
        weight: 1,
        confidence: 1,
        dynamic: 'stable',
        lastSignalAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        mergedIntoId: null,
        _count: { blocks: opts.blockRows.length, entities: 0 },
      })),
    },
    themeIdeaBlock: { findMany: vi.fn(async () => opts.blockRows) },
    themeEntity: { findMany: vi.fn(async () => []) },
    decision: { findMany: vi.fn(async () => []) },
    issue: { findMany: vi.fn(async () => []) },
    document: { findMany: vi.fn(async () => []) },
    regulation: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;

  const rbac = { canRead: async () => true } as unknown as RbacService;

  const resolveSpy = vi.fn(async () => opts.ctx);
  const partitionSpy = vi.fn(async () => opts.partition ?? { accessible: [], denied: 0 });
  const accessResolver = {
    resolveAccessibleGroups: resolveSpy,
    partitionBlockIdsByAccess: partitionSpy,
  } as unknown as KnowledgeAccessResolver;

  const cfg = {
    knowledgeAccess: { enforcement: opts.enforcement },
  } as unknown as TypedConfigService;

  const incDenied = vi.fn();
  const incShadow = vi.fn();
  const metrics = {
    incAccessDenied: incDenied,
    incAccessShadowDiff: incShadow,
  } as unknown as BusinessMetricsService;

  const ctrl = new KnowledgeThemesController(prisma, rbac, accessResolver, cfg, metrics);
  return { ctrl, resolveSpy, partitionSpy, incDenied, incShadow };
}

describe('KnowledgeThemesController — Ф4 гейт доступа (unit)', () => {
  it('off → resolver не вызывается, выдача = все блоки', async () => {
    const { ctrl, resolveSpy, partitionSpy } = buildGateThemes({
      enforcement: 'off',
      blockRows: [mkBlock('b1'), mkBlock('b2')],
      ctx: null,
    });
    const res = await ctrl.byId('t-1', GATE_USER, TENANT);
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('enforce → недоступный блок исключён из ответа + incAccessDenied', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { ctrl, partitionSpy, incDenied, incShadow } = buildGateThemes({
      enforcement: 'enforce',
      blockRows: [mkBlock('b1'), mkBlock('b2')],
      ctx,
      partition: { accessible: ['b1'], denied: 1 },
    });
    const res = await ctrl.byId('t-1', GATE_USER, TENANT);
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ['b1', 'b2']);
    expect(res.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'themes' }, 1);
    expect(incShadow).not.toHaveBeenCalled();
  });

  it('bypass → все блоки (partition не вызывается)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { ctrl, partitionSpy } = buildGateThemes({
      enforcement: 'enforce',
      blockRows: [mkBlock('b1'), mkBlock('b2')],
      ctx,
    });
    const res = await ctrl.byId('t-1', GATE_USER, TENANT);
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('shadow → выдача не меняется + incAccessShadowDiff', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { ctrl, incDenied, incShadow } = buildGateThemes({
      enforcement: 'shadow',
      blockRows: [mkBlock('b1'), mkBlock('b2')],
      ctx,
      partition: { accessible: ['b1'], denied: 1 },
    });
    const res = await ctrl.byId('t-1', GATE_USER, TENANT);
    expect(res.blocks.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(incShadow).toHaveBeenCalledWith({ surface: 'themes' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });
});

const F4_USER: CurrentUserPayload = { id: 'f4-user', email: 'f4@test', role: 'user' };
const F4_OTHER: CurrentUserPayload = { id: 'f4-other', email: 'o@test', role: 'user' };
const F4_TENANT = 'f4-org';

function themeRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    tenantId: F4_TENANT,
    name: 'Theme',
    description: '',
    branch: null,
    status: 'active',
    origin: 'user',
    visibility: 'personal',
    createdByUserId: F4_USER.id,
    weight: 1,
    confidence: 1,
    dynamic: 'stable',
    lastSignalAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    mergedIntoId: null,
    _count: { blocks: 0, entities: 0 },
    ...over,
  };
}

function mkThemeBlockRow(id: string): Record<string, unknown> {
  return {
    addedVia: 'autofill',
    score: 0.812,
    reason: 'Смысловая близость',
    weight: 0.8,
    createdAt: new Date(),
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
  };
}

function buildF4(opts: {
  theme?: Record<string, unknown> | null;
  canCreateTeamTheme?: boolean;
  autofillEnabled?: boolean;
  themeBlockRows?: Record<string, unknown>[];
  themeEntityIds?: string[];
  decisionRows?: Record<string, unknown>[];
  taskRows?: Record<string, unknown>[];
  documentRows?: Record<string, unknown>[];
  regulationRows?: Record<string, unknown>[];
}): {
  ctrl: KnowledgeThemesController;
  createTheme: ReturnType<typeof vi.fn>;
  fillTheme: ReturnType<typeof vi.fn>;
  unpin: ReturnType<typeof vi.fn>;
  incThemeExclusions: ReturnType<typeof vi.fn>;
} {
  const themeRow = opts.theme === undefined ? themeRecord() : opts.theme;
  const themeEntityIds = opts.themeEntityIds ?? [];
  const prisma = {
    theme: {
      findUnique: vi.fn(async () => themeRow),
    },
    themeIdeaBlock: { findMany: vi.fn(async () => opts.themeBlockRows ?? []) },
    themeEntity: {
      findMany: vi.fn(async () =>
        themeEntityIds.map((entityId) => ({
          entityId,
          entity: {
            id: entityId,
            type: 'person',
            canonicalName: entityId,
            aliases: [] as string[],
            mentionsCount: 0,
            metadata: null,
          },
        })),
      ),
    },
    decision: { findMany: vi.fn(async () => opts.decisionRows ?? []) },
    issue: { findMany: vi.fn(async () => opts.taskRows ?? []) },
    document: { findMany: vi.fn(async () => opts.documentRows ?? []) },
    regulation: { findMany: vi.fn(async () => opts.regulationRows ?? []) },
  } as unknown as PrismaService;

  const rbac = {
    canRead: async () => true,
    canCreateTeamTheme: async () => opts.canCreateTeamTheme ?? false,
  } as unknown as RbacService;

  const cfg = {
    themeAutofillOpts: async () => ({
      enabled: opts.autofillEnabled ?? true,
      threshold: 0.72,
      scanWindowDays: 14,
      maxPerScan: 50,
      dedupeSimilarity: 0.97,
    }),
  } as unknown as TypedConfigService;

  const createTheme = vi.fn(async () => ({ id: 't-1' }));
  const fillTheme = vi.fn(async () => ({ added: 0, addedBlockIds: [] as string[] }));
  const themeWrite = {
    createTheme,
    renameTheme: vi.fn(async () => undefined),
    archiveTheme: vi.fn(async () => undefined),
    pin: vi.fn(async () => undefined),
    unpin: vi.fn(async () => undefined),
  };
  const themeFill = { fillTheme };

  const incThemeExclusions = vi.fn();
  const metrics = {
    incThemeExclusions,
    incAccessDenied: vi.fn(),
    incAccessShadowDiff: vi.fn(),
  } as unknown as BusinessMetricsService;

  const ctrl = new KnowledgeThemesController(
    prisma,
    rbac,
    null,
    cfg,
    metrics,
    themeWrite as never,
    themeFill as never,
  );
  return { ctrl, createTheme, fillTheme, unpin: themeWrite.unpin, incThemeExclusions };
}

describe('KnowledgeThemesController — Ф4 темы пользователя (unit)', () => {
  it('create personal → createTheme + fillTheme вызваны, isMine=true', async () => {
    const { ctrl, createTheme, fillTheme } = buildF4({});
    const res = await ctrl.create(
      { phrase: 'моя тема', visibility: 'personal' },
      F4_USER,
      F4_TENANT,
    );
    expect(createTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: F4_TENANT,
        phrase: 'моя тема',
        visibility: 'personal',
        createdByUserId: F4_USER.id,
      }),
    );
    expect(fillTheme).toHaveBeenCalledTimes(1);
    expect(res.isMine).toBe(true);
    expect(res.visibility).toBe('personal');
  });

  it('create team рядовым (canCreateTeamTheme=false) → Forbidden forbidden_team_theme, createTheme НЕ вызван', async () => {
    const { ctrl, createTheme } = buildF4({ canCreateTeamTheme: false });
    await expect(
      ctrl.create({ phrase: 'команда', visibility: 'team' }, F4_USER, F4_TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createTheme).not.toHaveBeenCalled();
  });

  it('byId чужой personal-темы → NotFound theme_not_found', async () => {
    const { ctrl } = buildF4({
      theme: themeRecord({ visibility: 'personal', createdByUserId: F4_OTHER.id }),
    });
    await expect(ctrl.byId('t-1', F4_USER, F4_TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('byId возвращает blocks c addedVia/score/reason + секции regulations/documents/decisions/tasks', async () => {
    const { ctrl } = buildF4({
      theme: themeRecord({ _count: { blocks: 1, entities: 1 } }),
      themeBlockRows: [mkThemeBlockRow('b1')],
      themeEntityIds: ['e1'],
      decisionRows: [{ id: 'd1', statement: 'решили' }],
      taskRows: [{ id: 'i1', title: 'задача' }],
      documentRows: [{ id: 'doc1', name: 'док' }],
      regulationRows: [{ id: 'r1', name: 'регламент', category: 'regulation' }],
    });
    const res = await ctrl.byId('t-1', F4_USER, F4_TENANT);
    expect(res.blocks[0]).toEqual(
      expect.objectContaining({ id: 'b1', addedVia: 'autofill', reason: 'Смысловая близость' }),
    );
    expect(res.blocks[0]?.score).toBeCloseTo(0.812, 3);
    expect(res.decisions).toEqual([
      expect.objectContaining({ id: 'd1', statement: 'решили', reversibility: null, href: '/decisions/d1' }),
    ]);
    expect(res.tasks).toEqual([expect.objectContaining({ id: 'i1', href: '/issues/i1' })]);
    expect(res.documents).toEqual([
      expect.objectContaining({ id: 'doc1', title: 'док', href: '/documents/doc1' }),
    ]);
    expect(res.regulations).toEqual([
      expect.objectContaining({ id: 'r1', title: 'регламент', category: 'regulation', href: '/regulations/r1' }),
    ]);
  });

  it('DELETE pin владельцем personal → unpin вызван + incThemeExclusions', async () => {
    const { ctrl, unpin, incThemeExclusions } = buildF4({});
    const res = await ctrl.unpin('t-1', 'block', 'b1', F4_USER, F4_TENANT);
    expect(unpin).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: F4_TENANT, themeId: 't-1', kind: 'block', objectId: 'b1' }),
    );
    expect(incThemeExclusions).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
    );
    expect(res).toEqual({ ok: true });
  });

  it('DELETE pin с невалидным kind → BadRequest', async () => {
    const { ctrl } = buildF4({});
    await expect(ctrl.unpin('t-1', 'weird', 'b1', F4_USER, F4_TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
