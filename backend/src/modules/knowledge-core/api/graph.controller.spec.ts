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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import { buildKnowledgeCoreFixture } from '../../../../test/integration/knowledge-core/fixtures';

import { GraphNeighborsQuerySchema } from './dto/graph.dto';
import { KnowledgeGraphController } from './graph.controller';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';

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
