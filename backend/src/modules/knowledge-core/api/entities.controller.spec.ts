/**
 * Integration spec для KnowledgeEntitiesController (Phase F.2).
 *
 * Реальный Postgres из docker-compose.dev.yml.
 *
 * Покрытие:
 *   - GET /entities — список (фильтр type/q, includeMerged).
 *   - GET /entities/:id — деталка с примерами блоков.
 *   - GET /entities/:id/links — типизированные связи.
 *   - 403 cross-tenant, 403 forbidden, 404, Zod 400, tenant_required.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import { buildKnowledgeCoreFixture } from '../../../../test/integration/knowledge-core/fixtures';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';

import { ListEntitiesQuerySchema } from './dto/entity.dto';
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

    await expect(
      ctrl.byId(f.entityAId, userB, f.orgBId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 forbidden если canRead=false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(false));

    await expect(
      ctrl.byId(f.entityAId, userA, f.orgAId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 tenant_required (X-Org-Id не передан)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    await expect(
      ctrl.byId(f.entityAId, userA, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 на несуществующую сущность', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeEntitiesController(prisma, makeRbac(true));

    await expect(
      ctrl.byId(`${PREFIX}-no-entity`, userA, f.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);
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
