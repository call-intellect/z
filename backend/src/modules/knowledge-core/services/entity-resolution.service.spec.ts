/**
 * Integration spec для EntityResolutionService (Phase F.2).
 *
 * Реальный Postgres + pgvector из docker-compose.dev.yml. Если БД недоступна —
 * тесты skip'аются.
 *
 * Покрываемые сценарии (минимум, расширяется по мере надобности):
 *   - findOrCreateEntity: новое имя → create + mentionsCount=1.
 *   - findOrCreateEntity: повторное точное совпадение → update + mentionsCount+=1.
 *   - findOrCreateEntity: case-insensitive дедуп («Альфа» = «АЛЬФА»).
 *   - Изоляция per-tenant: одно имя в двух Org → две разные Entity.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import {
  buildKnowledgeCoreFixture,
  cleanupByPrefix,
} from '../../../../test/integration/knowledge-core/fixtures';

import { EntityResolutionService } from './entity-resolution.service';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeEmbeddingService } from './embedding.service';

const PREFIX = 'kc-entres-spec';

interface Ctx {
  dbReady: boolean;
  svc: EntityResolutionService | null;
  cleanup: (() => Promise<void>) | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}
const ctx: Ctx = { dbReady: false, svc: null, cleanup: null, fixture: null };

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  const prisma = await getPrismaClient();
  ctx.fixture = await buildKnowledgeCoreFixture(prisma, PREFIX);
  ctx.cleanup = ctx.fixture.cleanup;

  // Эмбеддинги мокаем — для F.2 они нам не критичны, плюс OpenAI ключи в
  // test-env поддельные. Возвращаем фиксированный 1536-мерный вектор.
  const embed = {
    embedEntityNames: vi.fn(async (names: string[]) =>
      names.map(() => new Array<number>(1536).fill(0)),
    ),
    embedQuery: vi.fn(async () => new Array<number>(1536).fill(0)),
  } as unknown as KnowledgeEmbeddingService;

  ctx.svc = new EntityResolutionService(
    prisma as unknown as PrismaService,
    embed,
  );
});

afterAll(async () => {
  if (ctx.cleanup) await ctx.cleanup();
  // Гарантия: даже если фикстура не отработала — стираем созданные нами entity.
  const prisma = await getPrismaClient().catch(() => null);
  if (prisma) await cleanupByPrefix(prisma, PREFIX);
  await closePrismaClient();
});

function skipIfNoDb(testCtx: { skip: () => void }): boolean {
  if (!ctx.dbReady) {
    testCtx.skip();
    return true;
  }
  return false;
}

describe('EntityResolutionService (integration)', () => {
  describe('findOrCreateEntity', () => {
    it('создаёт новую Entity при первом упоминании', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const { entity, created } = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-новая-тема`,
      });
      expect(created).toBe(true);
      expect(entity.mentionsCount).toBe(1);
      expect(entity.canonicalName).toBe(`${PREFIX}-новая-тема`);

      // Подчищаем созданную сущность (не покрыта prefix-cleanup'ом —
      // id у неё cuid).
      await prisma.entity.delete({ where: { id: entity.id } }).catch(() => undefined);
    });

    it('увеличивает mentionsCount при повторном точном совпадении', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const r1 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-recurring`,
      });
      const r2 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-recurring`,
      });
      expect(r1.created).toBe(true);
      expect(r2.created).toBe(false);
      expect(r2.entity.mentionsCount).toBe(2);

      await prisma.entity.delete({ where: { id: r2.entity.id } }).catch(() => undefined);
    });

    it('дедуплицирует case-insensitive: «Альфа» === «АЛЬФА»', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const lower = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-альфа`,
      });
      const upper = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-АЛЬФА`,
      });
      expect(upper.created).toBe(false);
      expect(upper.entity.id).toBe(lower.entity.id);
      expect(upper.entity.mentionsCount).toBe(2);

      await prisma.entity.delete({ where: { id: lower.entity.id } }).catch(() => undefined);
    });

    it('изоляция per-tenant: одно имя в двух Org → две разные Entity', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const a = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'topic',
        name: `${PREFIX}-shared-name`,
      });
      const b = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgBId,
        type: 'topic',
        name: `${PREFIX}-shared-name`,
      });
      expect(a.entity.id).not.toBe(b.entity.id);
      expect(a.entity.tenantId).toBe(f.orgAId);
      expect(b.entity.tenantId).toBe(f.orgBId);

      await prisma.entity.delete({ where: { id: a.entity.id } }).catch(() => undefined);
      await prisma.entity.delete({ where: { id: b.entity.id } }).catch(() => undefined);
    });

    it('кидает Error на пустое имя', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      await expect(
        ctx.svc!.findOrCreateEntity({
          tenantId: f.orgAId,
          type: 'topic',
          name: '   ',
        }),
      ).rejects.toThrow();
    });
  });
});
