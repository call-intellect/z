import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

function makeMocks(opts: { threshold?: number; cacheTtl?: number } = {}) {
  const queryRawUnsafe = vi.fn();
  const executeRawUnsafe = vi.fn(async () => 1);
  const entityFindUnique = vi.fn();
  const entityUpdate = vi.fn(async (args: { where: { id: string } }) => ({
    id: args.where.id,
    tenantId: 'org-1',
    type: 'topic',
    canonicalName: 'cached entity',
    mergedIntoId: null,
    mentionsCount: 2,
    metadata: null,
  }));
  const entityCreate = vi.fn(async (args: { data: { canonicalName: string } }) => ({
    id: 'ent-created',
    tenantId: 'org-1',
    type: 'topic',
    canonicalName: args.data.canonicalName,
    mergedIntoId: null,
    mentionsCount: 1,
    metadata: null,
  }));
  const prisma = {
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
    entity: {
      findUnique: entityFindUnique,
      update: entityUpdate,
      create: entityCreate,
    },
    person: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaService;

  const redisGet = vi.fn(async () => null as string | null);
  const redisSet = vi.fn(async () => 'OK');
  const redisDel = vi.fn(async () => 1);
  const redis = {
    client: { get: redisGet, set: redisSet, del: redisDel },
  } as unknown as RedisService;

  const embedNames = vi.fn(async (names: string[]) =>
    names.map(() => new Array<number>(1536).fill(0.1)),
  );
  const embeddings = {
    embedEntityNames: embedNames,
  } as unknown as KnowledgeEmbeddingService;

  const enqueueEntityResolver = vi.fn(async () => undefined);
  const coreQueue = {
    enqueueEntityResolver,
  } as unknown as CoreQueueService;

  const metrics = {
    incKcEntityResolvePath: vi.fn(),
    observeKcEntityResolveLatencyMs: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    entityIngest: {
      resolveThreshold: opts.threshold ?? 0.95,
      cacheTtlSeconds: opts.cacheTtl ?? 3600,
    },
  } as unknown as TypedConfigService;

  return {
    prisma,
    redis,
    embeddings,
    coreQueue,
    metrics,
    cfg,
    spies: {
      queryRawUnsafe,
      entityFindUnique,
      entityUpdate,
      entityCreate,
      redisGet,
      redisSet,
      redisDel,
      embedNames,
      enqueueEntityResolver,
      metrics,
    },
  };
}

describe('EntityResolutionService.findOrCreateEntity (W1.5 ingest-time KNN)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cache_hit: Redis возвращает entityId, мы пропускаем exact/KNN', async () => {
    const m = makeMocks();
    m.spies.redisGet.mockResolvedValueOnce('ent-cached');
    m.spies.entityFindUnique.mockResolvedValueOnce({
      id: 'ent-cached',
      tenantId: 'org-1',
      type: 'topic',
      canonicalName: 'OpenAI',
      mergedIntoId: null,
      mentionsCount: 5,
      metadata: null,
    });

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    const r = await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'topic',
      name: 'OpenAI',
    });

    expect(r.created).toBe(false);
    expect(m.spies.queryRawUnsafe).not.toHaveBeenCalled();
    expect(m.spies.embedNames).not.toHaveBeenCalled();
    expect(m.spies.entityCreate).not.toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'cache_hit',
    });
  });

  it('exact: raw SQL exact match → reuse + cache write', async () => {
    const m = makeMocks();
    m.spies.redisGet.mockResolvedValueOnce(null);
    m.spies.queryRawUnsafe.mockResolvedValueOnce([{ id: 'ent-exact' }]);
    m.spies.entityFindUnique.mockResolvedValueOnce({
      id: 'ent-exact',
      tenantId: 'org-1',
      type: 'topic',
      canonicalName: 'OpenAI',
      mergedIntoId: null,
      mentionsCount: 1,
      metadata: null,
    });

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    const r = await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'topic',
      name: 'OpenAI',
    });

    expect(r.created).toBe(false);
    expect(m.spies.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(m.spies.entityCreate).not.toHaveBeenCalled();
    expect(m.spies.embedNames).not.toHaveBeenCalled();
    expect(m.spies.redisSet).toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'exact',
    });
  });

  it('knn match: best similarity ≥ threshold → reuse без LLM', async () => {
    const m = makeMocks({ threshold: 0.95 });
    m.spies.redisGet.mockResolvedValueOnce(null);
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    m.spies.queryRawUnsafe.mockResolvedValueOnce([{ id: 'ent-knn', distance: 0.04 }]);
    m.spies.entityFindUnique.mockResolvedValueOnce({
      id: 'ent-knn',
      tenantId: 'org-1',
      type: 'topic',
      canonicalName: 'OpenAI Inc',
      mergedIntoId: null,
      mentionsCount: 3,
      metadata: null,
    });

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    const r = await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'topic',
      name: 'OpenAI',
    });

    expect(r.created).toBe(false);
    expect(m.spies.embedNames).toHaveBeenCalledTimes(1);
    expect(m.spies.entityCreate).not.toHaveBeenCalled();
    expect(m.spies.enqueueEntityResolver).not.toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'knn',
    });
  });

  it('Б44 [K4]: knn-reuse переносит пустые strong-IDs из найденного кандидата', async () => {
    const m = makeMocks({ threshold: 0.95 });
    m.spies.redisGet.mockResolvedValueOnce(null);
    // resolveByStrongIds: INN lookup → пусто, domain lookup → пусто
    // (strong-ID не нашёл сущность → падаем в exact → KNN).
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]); // inn lookup
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]); // domain lookup
    // Exact пусто.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    // KNN: distance=0.04 → similarity=0.96 (>= 0.95).
    m.spies.queryRawUnsafe.mockResolvedValueOnce([
      { id: 'ent-knn', distance: 0.04 },
    ]);
    // Найденный по KNN кандидат БЕЗ strong-полей (ИНН/домен пусты).
    m.spies.entityFindUnique.mockResolvedValueOnce({
      id: 'ent-knn',
      tenantId: 'org-1',
      type: 'customer',
      canonicalName: 'ООО Ромашка',
      mergedIntoId: null,
      mentionsCount: 3,
      metadata: null,
      inn: null,
      ogrn: null,
      email: null,
      phone: null,
      domain: null,
    });

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    const r = await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'customer',
      name: 'Ромашка',
      // Новый вызов принёс strong-IDs, которых не было у KNN-кандидата.
      inn: '7700000000', // 10 цифр — валидный ИНН юр.лица
      domain: 'romashka.ru',
    });

    expect(r.created).toBe(false);
    expect(m.spies.entityCreate).not.toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'knn',
    });
    // entity.update должен backfill'ить пустые strong-поля из нового вызова.
    expect(m.spies.entityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ent-knn' },
        data: expect.objectContaining({
          inn: '7700000000',
          domain: 'romashka.ru',
        }),
      }),
    );
  });

  it('Б44 [K4]: knn-reuse НЕ перетирает уже заполненные strong-IDs кандидата', async () => {
    const m = makeMocks({ threshold: 0.95 });
    m.spies.redisGet.mockResolvedValueOnce(null);
    // resolveByStrongIds: только INN lookup (domain не передан) → пусто.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]); // inn lookup
    // Exact пусто.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    // KNN: distance=0.04 → similarity=0.96.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([
      { id: 'ent-knn', distance: 0.04 },
    ]);
    // У кандидата УЖЕ есть ИНН — он не должен перезаписываться.
    m.spies.entityFindUnique.mockResolvedValueOnce({
      id: 'ent-knn',
      tenantId: 'org-1',
      type: 'customer',
      canonicalName: 'ООО Ромашка',
      mergedIntoId: null,
      mentionsCount: 3,
      metadata: null,
      inn: '5500000000',
      ogrn: null,
      email: null,
      phone: null,
      domain: null,
    });

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'customer',
      name: 'Ромашка',
      inn: '7700000000',
    });

    const updateArgs = (m.spies.entityUpdate.mock.calls as unknown[][])[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // inn не должен попасть в data (поле кандидата уже заполнено).
    expect(updateArgs.data).not.toHaveProperty('inn');
  });

  it('knn miss → create + enqueue entity-resolver + cache write', async () => {
    const m = makeMocks({ threshold: 0.95 });
    m.spies.redisGet.mockResolvedValueOnce(null);
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    m.spies.queryRawUnsafe.mockResolvedValueOnce([{ id: 'ent-far', distance: 0.2 }]);

    const svc = new EntityResolutionService(
      m.prisma,
      m.embeddings,
      m.redis,
      m.coreQueue,
      m.metrics,
      m.cfg,
    );

    const r = await svc.findOrCreateEntity({
      tenantId: 'org-1',
      type: 'topic',
      name: 'Совершенно новая сущность',
    });

    expect(r.created).toBe(true);
    expect(m.spies.entityCreate).toHaveBeenCalledTimes(1);
    expect(m.spies.enqueueEntityResolver).toHaveBeenCalledTimes(1);
    expect(m.spies.enqueueEntityResolver).toHaveBeenCalledWith('ent-created');
    expect(m.spies.redisSet).toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'create',
    });
  });
});
