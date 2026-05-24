/**
 * Integration spec для KnowledgeBlocksController (Phase F.2).
 *
 * Использует РЕАЛЬНЫЙ Postgres из docker-compose.dev.yml через PrismaClient
 * с driver-adapter pg. Если БД недоступна — все тесты файла skip'аются
 * (через `it.skipIf`).
 *
 * Что проверяем:
 *   - happy: GET /blocks/:id возвращает блок + evidence + entities.
 *   - happy: GET /blocks/:id/links возвращает outgoing + incoming.
 *   - 403 cross-tenant: запрос блока, принадлежащего другой Org → ForbiddenException
 *     (RBAC) или NotFound (tenant-fence). Главное: НЕ 200 с данными чужой Org.
 *   - 403 forbidden (RBAC.canRead → false).
 *   - 404 на несуществующий блок.
 *   - tenant_required (без X-Org-Id).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  checkPgvectorAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import { buildKnowledgeCoreFixture } from '../../../../test/integration/knowledge-core/fixtures';

import { KnowledgeBlocksController } from './blocks.controller';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';

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
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

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
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

    // userB пытается прочитать блок Org A через свой X-Org-Id = orgB.
    await expect(ctrl.byId(f.blockAId, userB, f.orgBId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 forbidden если RBAC.canRead вернул false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacDeny());

    await expect(ctrl.byId(f.blockAId, userA, f.orgAId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 tenant_required если X-Org-Id не передан', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

    await expect(ctrl.byId(f.blockAId, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 на несуществующий blockId', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

    await expect(
      ctrl.byId(`${PREFIX}-missing-block`, userA, f.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET /blocks/:id/links возвращает outgoing+incoming (пустые при отсутствии связей)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

    const res = await ctrl.links(f.blockAId, userA, f.orgAId);
    expect(Array.isArray(res.outgoing)).toBe(true);
    expect(Array.isArray(res.incoming)).toBe(true);
  });

  it('GET /blocks/:id/links для блока другой Org → NotFoundException', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeBlocksController(prisma, makeRbacAllowAll());

    await expect(ctrl.links(f.blockAId, userB, f.orgBId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
