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
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

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

  const embed = {
    embedEntityNames: vi.fn(async (names: string[]) =>
      names.map(() => new Array<number>(1536).fill(0)),
    ),
    embedQuery: vi.fn(async () => new Array<number>(1536).fill(0)),
  } as unknown as KnowledgeEmbeddingService;

  ctx.svc = new EntityResolutionService(prisma as unknown as PrismaService, embed);
});

afterAll(async () => {
  if (ctx.cleanup) await ctx.cleanup();
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

  describe('findOrCreateEntity — strong-IDs (W3.4)', () => {
    it('резолвит по ИНН — старая Entity возвращается, mentionsCount++', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const r1 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'vendor',
        name: `${PREFIX}-ООО Альфа Продакшн`,
        inn: '7707083893',
      });
      expect(r1.created).toBe(true);
      expect(r1.entity.inn).toBe('7707083893');

      const r2 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'vendor',
        name: `${PREFIX}-Альфа`,
        inn: '7707083893',
      });
      expect(r2.created).toBe(false);
      expect(r2.entity.id).toBe(r1.entity.id);
      expect(r2.entity.mentionsCount).toBe(2);

      const r3 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'vendor',
        name: `${PREFIX}-АЛЬФА`,
        inn: '7707-083-893',
      });
      expect(r3.created).toBe(false);
      expect(r3.entity.id).toBe(r1.entity.id);
      expect(r3.entity.mentionsCount).toBe(3);

      await prisma.entity.delete({ where: { id: r1.entity.id } }).catch(() => undefined);
    });

    it('fallback на name/KNN если strong-IDs не заданы или не найдены', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const r1 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'customer',
        name: `${PREFIX}-customer-no-inn`,
      });
      expect(r1.created).toBe(true);
      expect(r1.entity.inn).toBeNull();

      const r2 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'customer',
        name: `${PREFIX}-customer-no-inn`,
        inn: '1234567890',
      });
      expect(r2.created).toBe(false);
      expect(r2.entity.id).toBe(r1.entity.id);
      expect(r2.entity.inn).toBe('1234567890');

      await prisma.entity.delete({ where: { id: r1.entity.id } }).catch(() => undefined);
    });

    it('изоляция per-tenant: одинаковый ИНН в двух Org → две разные Entity', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const a = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'vendor',
        name: `${PREFIX}-vendor-tenant-A`,
        inn: '9999999999',
      });
      const b = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgBId,
        type: 'vendor',
        name: `${PREFIX}-vendor-tenant-B`,
        inn: '9999999999',
      });
      expect(a.entity.id).not.toBe(b.entity.id);
      expect(a.entity.tenantId).toBe(f.orgAId);
      expect(b.entity.tenantId).toBe(f.orgBId);

      await prisma.entity.delete({ where: { id: a.entity.id } }).catch(() => undefined);
      await prisma.entity.delete({ where: { id: b.entity.id } }).catch(() => undefined);
    });

    it('резолвит по email — case-insensitive нормализация', async (testCtx) => {
      if (skipIfNoDb(testCtx)) return;
      const f = ctx.fixture!;
      const prisma = await getPrismaClient();

      const r1 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'person',
        name: `${PREFIX}-Иван Петров`,
        email: 'Ivan.Petrov@Example.COM',
      });
      expect(r1.created).toBe(true);
      expect(r1.entity.email).toBe('ivan.petrov@example.com');

      const r2 = await ctx.svc!.findOrCreateEntity({
        tenantId: f.orgAId,
        type: 'person',
        name: `${PREFIX}-И. Петров`,
        email: 'ivan.petrov@example.com',
      });
      expect(r2.created).toBe(false);
      expect(r2.entity.id).toBe(r1.entity.id);

      await prisma.entity.delete({ where: { id: r1.entity.id } }).catch(() => undefined);
    });
  });
});

describe('EntityResolutionService.resolveSubjectEntityId — Ф1 per-adapter identity (unit)', () => {
  function buildSvc(personFindFirst: ReturnType<typeof vi.fn>): EntityResolutionService {
    const prisma = {
      person: { findFirst: personFindFirst },
    } as unknown as PrismaService;
    const embed = {} as unknown as KnowledgeEmbeddingService;
    return new EntityResolutionService(prisma, embed);
  }

  it('authorPersonId → Person с entityId → возвращает entityId (без ensure)', async () => {
    const findFirst = vi.fn(async () => ({ id: 'pers-1', entityId: 'ent-1' }));
    const svc = buildSvc(findFirst);

    const res = await svc.resolveSubjectEntityId('tenant-1', {
      authorPersonId: 'pers-1',
    });

    expect(res).toBe('ent-1');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'pers-1',
          tenantId: 'tenant-1',
          deletedAt: null,
        }),
      }),
    );
  });

  it('authorEmail → Person по email (case-insensitive) → возвращает entityId', async () => {
    const findFirst = vi.fn(async () => ({ id: 'pers-2', entityId: 'ent-2' }));
    const svc = buildSvc(findFirst);

    const res = await svc.resolveSubjectEntityId('tenant-1', {
      authorEmail: 'Ivan@Example.COM',
    });

    expect(res).toBe('ent-2');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          email: expect.objectContaining({
            equals: 'Ivan@Example.COM',
            mode: 'insensitive',
          }),
          deletedAt: null,
        }),
      }),
    );
  });

  it('authorPersonId имеет приоритет над authorUserId (первый успех возвращается)', async () => {
    const findFirst = vi.fn(async () => ({ id: 'pers-3', entityId: 'ent-3' }));
    const svc = buildSvc(findFirst);

    const res = await svc.resolveSubjectEntityId('tenant-1', {
      authorPersonId: 'pers-3',
      authorUserId: 'user-x',
    });

    expect(res).toBe('ent-3');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pers-3' }),
      }),
    );
  });
});
