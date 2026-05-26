/**
 * Integration spec для KnowledgeThemesController (Phase F.2).
 *
 * Использует РЕАЛЬНЫЙ Postgres из docker-compose.dev.yml.
 *
 * Покрытие:
 *   - GET /themes — список тем Org с фильтрами.
 *   - GET /themes/:id — деталка темы с блоками + сущностями.
 *   - POST /themes/:id/save-as-card — конвертация темы → Card.
 *   - 403 cross-tenant, 403 forbidden, 404 not_found, Zod 400.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

import {
  ListThemesQuerySchema,
  SaveThemeAsCardSchema,
} from './dto/theme.dto';
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
    // Тема создавалась только для OrgA — для OrgB её быть не должно.
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

    await expect(ctrl.byId(f.themeAId, userB, f.orgBId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 forbidden если canRead=false', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(false));

    await expect(ctrl.byId(f.themeAId, userA, f.orgAId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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

    await expect(
      ctrl.byId(`${PREFIX}-no-theme`, userA, f.orgAId),
    ).rejects.toBeInstanceOf(NotFoundException);
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

    // Подчищаем — иначе при повторном запуске будет ConflictException.
    await prisma.card.delete({ where: { id: res.cardId } }).catch(() => undefined);
  });

  it('POST /themes/:id/save-as-card 403 cross-tenant', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const f = ctx.fixture!;
    const ctrl = new KnowledgeThemesController(prisma, makeRbac(true, true));

    await expect(
      ctrl.saveAsCard(
        f.themeAId,
        { name: `${PREFIX}-no` },
        userB,
        f.orgBId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Заодно — BadRequest на попытку safeParse с пустой строкой:
    expect(SaveThemeAsCardSchema.safeParse({ name: '' }).success).toBe(false);

    // BadRequestException не выбрасывается т.к. wrapper в zod — лишний sanity-check.
    expect(BadRequestException).toBeDefined();
  });
});
