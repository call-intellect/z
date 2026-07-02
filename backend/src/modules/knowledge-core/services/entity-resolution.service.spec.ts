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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: entity.id, tenantId: entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: r2.entity.id, tenantId: r2.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: lower.entity.id, tenantId: lower.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: a.entity.id, tenantId: a.entity.tenantId } } })
        .catch(() => undefined);
      await prisma.entity
        .delete({ where: { id_tenantId: { id: b.entity.id, tenantId: b.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: r1.entity.id, tenantId: r1.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: r1.entity.id, tenantId: r1.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: a.entity.id, tenantId: a.entity.tenantId } } })
        .catch(() => undefined);
      await prisma.entity
        .delete({ where: { id_tenantId: { id: b.entity.id, tenantId: b.entity.tenantId } } })
        .catch(() => undefined);
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

      await prisma.entity
        .delete({ where: { id_tenantId: { id: r1.entity.id, tenantId: r1.entity.tenantId } } })
        .catch(() => undefined);
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

// ───────────────────────────────────────────────────────────────────────────
// Б15/Б20 [K3] (2026-06-16) — детерминированная привязка Entity↔Person:
// при >1 тёзке НЕ линкуем; при ровно 1 совпадении — линкуем детерминированно
// (orderBy id ASC). Юнит-тесты с моканым prisma (БД не нужна).
// ───────────────────────────────────────────────────────────────────────────
describe('EntityResolutionService — Entity↔Person линковка тёзок (Б15/Б20)', () => {
  describe('linkEntityPerson (Entity{person} → Person)', () => {
    function buildSvc(opts: {
      entity: { tenantId: string; type: string; canonicalName: string } | null;
      persons: Array<{ id: string; name: string }>;
      personUpdate: ReturnType<typeof vi.fn>;
    }): EntityResolutionService {
      const prisma = {
        entity: { findUnique: vi.fn(async () => opts.entity) },
        person: {
          findMany: vi.fn(async () => opts.persons),
          update: opts.personUpdate,
        },
      } as unknown as PrismaService;
      const embed = {} as unknown as KnowledgeEmbeddingService;
      return new EntityResolutionService(prisma, embed);
    }

    it('РОВНО 1 Person-тёзка → линкуется', async () => {
      const personUpdate = vi.fn(async () => ({}));
      const svc = buildSvc({
        entity: { tenantId: 't1', type: 'person', canonicalName: 'Иван Иванов' },
        persons: [{ id: 'p-1', name: 'Иван Иванов' }],
        personUpdate,
      });

      await svc.linkEntityPerson({ tenantId: 't1', entityId: 'e-1' });

      expect(personUpdate).toHaveBeenCalledTimes(1);
      expect(personUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1' },
          data: { entityId: 'e-1', entityTenantId: 't1' },
        }),
      );
    });

    it('>1 Person-тёзка → НЕ линкуется (неоднозначность)', async () => {
      const personUpdate = vi.fn(async () => ({}));
      const svc = buildSvc({
        entity: { tenantId: 't1', type: 'person', canonicalName: 'Иван Иванов' },
        // Два Person с одинаковым именем — тёзки.
        persons: [
          { id: 'p-1', name: 'Иван Иванов' },
          { id: 'p-2', name: 'иван иванов' },
        ],
        personUpdate,
      });

      await svc.linkEntityPerson({ tenantId: 't1', entityId: 'e-1' });

      expect(personUpdate).not.toHaveBeenCalled();
    });

    it('findMany вызывается с детерминированным orderBy id ASC', async () => {
      const findMany = vi.fn(async () => [] as Array<{ id: string; name: string }>);
      const prisma = {
        entity: {
          findUnique: vi.fn(async () => ({
            tenantId: 't1',
            type: 'person',
            canonicalName: 'Кто-то',
          })),
        },
        person: { findMany, update: vi.fn() },
      } as unknown as PrismaService;
      const svc = new EntityResolutionService(
        prisma,
        {} as unknown as KnowledgeEmbeddingService,
      );

      await svc.linkEntityPerson({ tenantId: 't1', entityId: 'e-1' });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { id: 'asc' } }),
      );
    });
  });

  describe('linkPersonEntity (Person → Entity{person})', () => {
    function buildSvc(opts: {
      person: {
        tenantId: string;
        name: string;
        entityId: string | null;
        deletedAt: Date | null;
      } | null;
      entities: Array<{ id: string; canonicalName: string }>;
      personUpdate: ReturnType<typeof vi.fn>;
    }): EntityResolutionService {
      const prisma = {
        person: {
          findUnique: vi.fn(async () => opts.person),
          update: opts.personUpdate,
        },
        entity: { findMany: vi.fn(async () => opts.entities) },
      } as unknown as PrismaService;
      const embed = {} as unknown as KnowledgeEmbeddingService;
      return new EntityResolutionService(prisma, embed);
    }

    it('РОВНО 1 Entity-тёзка → линкуется', async () => {
      const personUpdate = vi.fn(async () => ({}));
      const svc = buildSvc({
        person: { tenantId: 't1', name: 'Пётр Петров', entityId: null, deletedAt: null },
        entities: [{ id: 'e-1', canonicalName: 'Пётр Петров' }],
        personUpdate,
      });

      await svc.linkPersonEntity({ tenantId: 't1', personId: 'p-1' });

      expect(personUpdate).toHaveBeenCalledTimes(1);
      expect(personUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-1' },
          data: { entityId: 'e-1', entityTenantId: 't1' },
        }),
      );
    });

    it('>1 Entity-тёзка → НЕ линкуется (неоднозначность)', async () => {
      const personUpdate = vi.fn(async () => ({}));
      const svc = buildSvc({
        person: { tenantId: 't1', name: 'Пётр Петров', entityId: null, deletedAt: null },
        entities: [
          { id: 'e-1', canonicalName: 'Пётр Петров' },
          { id: 'e-2', canonicalName: 'ПЁТР ПЕТРОВ' },
        ],
        personUpdate,
      });

      await svc.linkPersonEntity({ tenantId: 't1', personId: 'p-1' });

      expect(personUpdate).not.toHaveBeenCalled();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Б29 [K6] (2026-06-16) — negative-cache distinct-пар (Redis).
// markEntityPairDistinct / isEntityPairDistinct: ключ симметричен по паре,
// best-effort (нет Redis → no-op / false).
// ───────────────────────────────────────────────────────────────────────────
describe('EntityResolutionService — negative-cache distinct-пар (Б29)', () => {
  function buildSvc(redisClient: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  }): EntityResolutionService {
    const prisma = {} as unknown as PrismaService;
    const embed = {} as unknown as KnowledgeEmbeddingService;
    const redis = { client: redisClient } as never;
    // (prisma, embeddings, redis, coreQueue, metrics, cfg, events)
    return new EntityResolutionService(prisma, embed, redis);
  }

  it('markEntityPairDistinct пишет SET с симметричным ключом (порядок id не важен)', async () => {
    const set = vi.fn(async (..._args: unknown[]) => 'OK');
    const get = vi.fn();
    const svc = buildSvc({ get, set });

    await svc.markEntityPairDistinct('b-zzz', 'a-aaa');
    await svc.markEntityPairDistinct('a-aaa', 'b-zzz');

    expect(set).toHaveBeenCalledTimes(2);
    const key1 = set.mock.calls[0]![0] as string;
    const key2 = set.mock.calls[1]![0] as string;
    expect(key1).toBe(key2); // симметрично по паре
    // упорядоченная пара (lo:hi) → a-aaa раньше b-zzz
    expect(key1).toContain('a-aaa');
    expect(key1).toContain('b-zzz');
    // TTL задан (EX, число секунд > 0)
    expect(set.mock.calls[0]).toEqual(
      expect.arrayContaining(['EX']),
    );
  });

  it('isEntityPairDistinct: судёная пара → true; несудёная → false', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce('1') // первая пара есть в кэше
      .mockResolvedValueOnce(null); // вторая — нет
    const svc = buildSvc({ get, set: vi.fn() });

    expect(await svc.isEntityPairDistinct('e1', 'e2')).toBe(true);
    expect(await svc.isEntityPairDistinct('e3', 'e4')).toBe(false);
  });

  it('isEntityPairDistinct по одному и тому же id → false (без обращения к Redis)', async () => {
    const get = vi.fn();
    const svc = buildSvc({ get, set: vi.fn() });
    expect(await svc.isEntityPairDistinct('same', 'same')).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('нет Redis → markEntityPairDistinct no-op, isEntityPairDistinct false', async () => {
    const prisma = {} as unknown as PrismaService;
    const embed = {} as unknown as KnowledgeEmbeddingService;
    const svc = new EntityResolutionService(prisma, embed); // без redis
    await expect(
      svc.markEntityPairDistinct('e1', 'e2'),
    ).resolves.toBeUndefined();
    expect(await svc.isEntityPairDistinct('e1', 'e2')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ф5 cross-source identity (2026-06-24) — resolvePersonByHint каскад:
// exact → alias-cache → fuzzy → эмбеддинг-склейка → LLM-арбитр (fail-closed).
// R-2: разных людей НИКОГДА не склеиваем. Юнит-тесты с моканым prisma.
// ───────────────────────────────────────────────────────────────────────────
describe('EntityResolutionService.resolvePersonByHint — cross-source identity (Ф5)', () => {
  function buildSvc(opts: {
    persons: Array<{ id: string; name: string }>;
    aliasFindUnique?: ReturnType<typeof vi.fn>;
    aliasUpsert?: ReturnType<typeof vi.fn>;
    aliasDelete?: ReturnType<typeof vi.fn>;
    personFindFirst?: ReturnType<typeof vi.fn>;
    queryRawUnsafe?: ReturnType<typeof vi.fn>;
    embedQuery?: ReturnType<typeof vi.fn>;
    cfgGetDynamic?: ReturnType<typeof vi.fn>;
    llmCall?: ReturnType<typeof vi.fn>;
  }): EntityResolutionService {
    const prisma = {
      person: {
        findMany: vi.fn(async () => opts.persons),
        findFirst: opts.personFindFirst ?? vi.fn(async () => null),
      },
      entityAlias: {
        findUnique: opts.aliasFindUnique ?? vi.fn(async () => null),
        upsert: opts.aliasUpsert ?? vi.fn(async () => ({})),
        delete: opts.aliasDelete ?? vi.fn(async () => ({})),
      },
      $queryRawUnsafe: opts.queryRawUnsafe ?? vi.fn(async () => []),
    } as unknown as PrismaService;
    const embed = {
      embedQuery: opts.embedQuery ?? vi.fn(async () => new Array<number>(1536).fill(0)),
    } as unknown as KnowledgeEmbeddingService;
    const cfg = {
      getDynamic: opts.cfgGetDynamic ?? vi.fn(async () => 0.9),
    } as never;
    const llm = opts.llmCall ? ({ call: opts.llmCall } as never) : undefined;
    // (prisma, embeddings, redis, coreQueue, metrics, cfg, events, llm)
    return new EntityResolutionService(
      prisma,
      embed,
      undefined,
      undefined,
      undefined,
      cfg,
      undefined,
      llm,
    );
  }

  it('alias-cache hit: живой Person → возвращает personId, без fuzzy/embedding', async () => {
    const aliasFindUnique = vi.fn(async () => ({ personId: 'p-cached' }));
    const personFindFirst = vi.fn(async () => ({ id: 'p-cached' }));
    const queryRawUnsafe = vi.fn(async () => [{ id: 'p-x', score: 0.99 }]);
    const embedQuery = vi.fn(async () => new Array<number>(1536).fill(0));
    const svc = buildSvc({
      persons: [{ id: 'p-cached', name: 'Анастасия Иванова' }],
      aliasFindUnique,
      personFindFirst,
      queryRawUnsafe,
      embedQuery,
    });

    const res = await svc.resolvePersonByHint('t1', 'Настя');

    expect(res).toBe('p-cached');
    expect(aliasFindUnique).toHaveBeenCalledTimes(1);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('embedding unambiguous: один кандидат ≥0.9 → возвращает id + populateAlias upsert', async () => {
    const aliasUpsert = vi.fn(async () => ({}));
    const queryRawUnsafe = vi.fn(async () => [{ id: 'p-emb', score: 0.95 }]);
    const svc = buildSvc({
      // Нет exact, нет fuzzy substring совпадения с «настя».
      persons: [{ id: 'p-emb', name: 'Анастасия Петрова' }],
      aliasUpsert,
      queryRawUnsafe,
    });

    const res = await svc.resolvePersonByHint('t1', 'Настя');

    expect(res).toBe('p-emb');
    expect(aliasUpsert).toHaveBeenCalledTimes(1);
    expect(aliasUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_alias: { tenantId: 't1', alias: 'настя' } },
        create: { tenantId: 't1', alias: 'настя', personId: 'p-emb' },
      }),
    );
  });

  it('ambiguous fail-closed: два кандидата ≥0.9, llm недоступен → null', async () => {
    const aliasUpsert = vi.fn(async () => ({}));
    const queryRawUnsafe = vi.fn(async () => [
      { id: 'p-a', score: 0.95 },
      { id: 'p-b', score: 0.93 },
    ]);
    const svc = buildSvc({
      persons: [
        { id: 'p-a', name: 'Анастасия Петрова' },
        { id: 'p-b', name: 'Анастасия Сидорова' },
      ],
      aliasUpsert,
      queryRawUnsafe,
      // llmCall не задан → llm=undefined
    });

    const res = await svc.resolvePersonByHint('t1', 'Настя', 'обсуждали бюджет');

    expect(res).toBeNull();
    expect(aliasUpsert).not.toHaveBeenCalled();
  });

  it('ambiguous + llm + context → арбитр выбирает одного из списка', async () => {
    const aliasUpsert = vi.fn(async () => ({}));
    const queryRawUnsafe = vi.fn(async () => [
      { id: 'p-a', score: 0.95 },
      { id: 'p-b', score: 0.93 },
    ]);
    const llmCall = vi.fn(async () => ({ text: '{"personId":"p-b"}' }));
    const svc = buildSvc({
      persons: [
        { id: 'p-a', name: 'Анастасия Петрова' },
        { id: 'p-b', name: 'Анастасия Сидорова' },
      ],
      aliasUpsert,
      queryRawUnsafe,
      llmCall,
    });

    const res = await svc.resolvePersonByHint('t1', 'Настя', 'обсуждали бюджет');

    expect(res).toBe('p-b');
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(aliasUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { tenantId: 't1', alias: 'настя', personId: 'p-b' },
      }),
    );
  });

  it('арбитр вернул id вне списка → null (fail-closed)', async () => {
    const queryRawUnsafe = vi.fn(async () => [
      { id: 'p-a', score: 0.95 },
      { id: 'p-b', score: 0.93 },
    ]);
    const llmCall = vi.fn(async () => ({ text: '{"personId":"p-zzz"}' }));
    const svc = buildSvc({
      persons: [
        { id: 'p-a', name: 'Анастасия Петрова' },
        { id: 'p-b', name: 'Анастасия Сидорова' },
      ],
      queryRawUnsafe,
      llmCall,
    });

    const res = await svc.resolvePersonByHint('t1', 'Настя', 'обсуждали бюджет');
    expect(res).toBeNull();
  });

  it('exact-name всё ещё работает (регресс) + populateAlias', async () => {
    const aliasUpsert = vi.fn(async () => ({}));
    const aliasFindUnique = vi.fn(async () => null);
    const svc = buildSvc({
      persons: [{ id: 'p-exact', name: 'Иван Петров' }],
      aliasUpsert,
      aliasFindUnique,
    });

    const res = await svc.resolvePersonByHint('t1', 'Иван Петров');

    expect(res).toBe('p-exact');
    expect(aliasFindUnique).not.toHaveBeenCalled();
    expect(aliasUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { tenantId: 't1', alias: 'иван петров', personId: 'p-exact' },
      }),
    );
  });
});

describe('EntityResolutionService.findOrCreateCustomerEntity (unit)', () => {
  function buildSvc(opts: {
    customerFindFirst?: ReturnType<typeof vi.fn>;
    customerFindUnique?: ReturnType<typeof vi.fn>;
    customerCreate?: ReturnType<typeof vi.fn>;
    entityFindUnique?: ReturnType<typeof vi.fn>;
    entityUpdate?: ReturnType<typeof vi.fn>;
  }): EntityResolutionService {
    const prisma = {
      customer: {
        findFirst: opts.customerFindFirst ?? vi.fn(async () => null),
        findUnique: opts.customerFindUnique ?? vi.fn(async () => null),
        create: opts.customerCreate ?? vi.fn(async () => ({ id: 'cust-new' })),
      },
      entity: {
        findUnique: opts.entityFindUnique ?? vi.fn(async () => null),
        update: opts.entityUpdate ?? vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
      },
    } as unknown as PrismaService;
    const embed = {} as unknown as KnowledgeEmbeddingService;
    return new EntityResolutionService(prisma, embed);
  }

  it('пустое имя → бросает Error', async () => {
    const svc = buildSvc({});
    await expect(
      svc.findOrCreateCustomerEntity({ tenantId: 't1', name: '   ' }),
    ).rejects.toThrow('EntityResolution: пустое имя customer');
  });

  it('customer уже есть по externalCrmId → created:false, create НЕ вызван', async () => {
    const customerFindFirst = vi.fn(async () => ({ id: 'cust-1', entityId: 'ent-1' }));
    const entityFindUnique = vi.fn(async () => ({ id: 'ent-1', tenantId: 't1', type: 'customer' }));
    const entityUpdate = vi.fn(async () => ({ id: 'ent-1', tenantId: 't1', type: 'customer' }));
    const customerCreate = vi.fn(async () => ({ id: 'should-not-be-called' }));
    const svc = buildSvc({ customerFindFirst, entityFindUnique, entityUpdate, customerCreate });

    const res = await svc.findOrCreateCustomerEntity({
      tenantId: 't1',
      name: 'ООО Клиент',
      externalCrmId: 'crm-42',
    });

    expect(res.created).toBe(false);
    expect(res.customerId).toBe('cust-1');
    expect(res.entity.id).toBe('ent-1');
    expect(customerCreate).not.toHaveBeenCalled();
    expect(customerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          externalCrmId: 'crm-42',
          deletedAt: null,
        }),
      }),
    );
    expect(entityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'ent-1', tenantId: 't1' } },
        data: { mentionsCount: { increment: 1 } },
      }),
    );
  });

  it('новый клиент → findOrCreateEntity с type:customer, создаёт Customer, created:true', async () => {
    const customerCreate = vi.fn(async () => ({ id: 'cust-new' }));
    const svc = buildSvc({ customerCreate });
    const resolveSpy = vi
      .spyOn(svc, 'findOrCreateEntity')
      .mockResolvedValue({
        entity: { id: 'ent-new', tenantId: 't1', type: 'customer' } as never,
        created: true,
      });

    const res = await svc.findOrCreateCustomerEntity({
      tenantId: 't1',
      name: '  Новый Клиент  ',
      email: 'a@b.com',
      source: 'chatbox',
    });

    expect(res.created).toBe(true);
    expect(res.customerId).toBe('cust-new');
    expect(res.entity.id).toBe('ent-new');
    expect(resolveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', type: 'customer', name: 'Новый Клиент' }),
    );
    expect(customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          entityId: 'ent-new',
          name: 'Новый Клиент',
          email: 'a@b.com',
          source: 'chatbox',
          status: 'active',
        }),
      }),
    );
  });

  it('Entity новый, но Customer по entityId уже есть → created:false, create НЕ вызван', async () => {
    const customerFindUnique = vi.fn(async () => ({ id: 'cust-existing' }));
    const customerCreate = vi.fn(async () => ({ id: 'should-not-be-called' }));
    const svc = buildSvc({ customerFindUnique, customerCreate });
    vi.spyOn(svc, 'findOrCreateEntity').mockResolvedValue({
      entity: { id: 'ent-x', tenantId: 't1', type: 'customer' } as never,
      created: false,
    });

    const res = await svc.findOrCreateCustomerEntity({ tenantId: 't1', name: 'Клиент X' });

    expect(res.created).toBe(false);
    expect(res.customerId).toBe('cust-existing');
    expect(res.entity.id).toBe('ent-x');
    expect(customerCreate).not.toHaveBeenCalled();
    expect(customerFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityId: 'ent-x' } }),
    );
  });
});

describe('EntityResolutionService.resolvePersonByEmbedding — Ф1 FROM persons (integration)', () => {
  it('возвращает Person-кандидата по эмбеддингу (raw SQL FROM persons не падает 42P01)', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const f = ctx.fixture!;
    const prisma = await getPrismaClient();
    const tenant = f.orgAId;

    const entId = `${PREFIX}-emb-person-ent`;
    const personId = `${PREFIX}-emb-person`;
    const vec = new Array<number>(1536).fill(0.1);
    const vecLiteral = `[${vec.join(',')}]`;

    await prisma.entity.create({
      data: {
        id: entId,
        tenantId: tenant,
        type: 'person',
        canonicalName: `${PREFIX}-Эмбеддинг Персона`,
        aliases: [],
        mentionsCount: 1,
      },
    });
    await prisma.$executeRawUnsafe(
      'UPDATE "Entity" SET embedding = $1::vector WHERE id = $2 AND "tenantId" = $3',
      vecLiteral,
      entId,
      tenant,
    );
    await prisma.person.create({
      data: {
        id: personId,
        tenantId: tenant,
        name: `${PREFIX}-Эмбеддинг Персона`,
        email: `${PREFIX}-emb-person@test.local`,
        entityId: entId,
        entityTenantId: tenant,
      },
    });

    const embed = {
      embedEntityNames: vi.fn(async (names: string[]) =>
        names.map(() => vec.slice()),
      ),
      embedQuery: vi.fn(async () => vec.slice()),
    } as unknown as KnowledgeEmbeddingService;
    const svc = new EntityResolutionService(prisma as unknown as PrismaService, embed);

    const rows = await (
      svc as unknown as {
        resolvePersonByEmbedding: (
          t: string,
          n: string,
        ) => Promise<Array<{ id: string; score: number }>>;
      }
    ).resolvePersonByEmbedding(tenant, `${PREFIX}-Эмбеддинг Персона`);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === personId)).toBe(true);
    const hit = rows.find((r) => r.id === personId);
    expect(hit!.score).toBeGreaterThanOrEqual(0.9);

    await prisma.person
      .delete({ where: { id: personId } })
      .catch(() => undefined);
    await prisma.entity
      .delete({ where: { id_tenantId: { id: entId, tenantId: tenant } } })
      .catch(() => undefined);
  });
});
