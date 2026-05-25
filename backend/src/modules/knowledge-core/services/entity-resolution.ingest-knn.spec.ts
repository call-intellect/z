/**
 * KC-Temporal W1.5 — unit-тесты ingest-time KNN resolver в
 * EntityResolutionService.findOrCreateEntity.
 *
 * Покрытие:
 *   - cache_hit: Redis вернул entityId → берём из БД без exact/KNN.
 *   - exact path: raw SQL exact match → reuse.
 *   - knn path: best similarity ≥ threshold → reuse без LLM.
 *   - knn miss → create + enqueue async resolver + cache write.
 *
 * Postgres не требуется — все зависимости моки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntityResolutionService } from './entity-resolution.service';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { KnowledgeEmbeddingService } from './embedding.service';

function makeMocks(opts: { threshold?: number; cacheTtl?: number } = {}) {
  // Prisma — последовательность $queryRawUnsafe вызовов разная в каждом тесте;
  // тест сам контролирует mockResolvedValueOnce.
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
      // linkEntityPerson вызывается для type='person'; в наших тестах type='topic'.
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaService;

  // Redis
  const redisGet = vi.fn(async () => null as string | null);
  const redisSet = vi.fn(async () => 'OK');
  const redisDel = vi.fn(async () => 1);
  const redis = {
    client: { get: redisGet, set: redisSet, del: redisDel },
  } as unknown as RedisService;

  // Embedding
  const embedNames = vi.fn(async (names: string[]) =>
    names.map(() => new Array<number>(1536).fill(0.1)),
  );
  const embeddings = {
    embedEntityNames: embedNames,
  } as unknown as KnowledgeEmbeddingService;

  // CoreQueue
  const enqueueEntityResolver = vi.fn(async () => undefined);
  const coreQueue = {
    enqueueEntityResolver,
  } as unknown as CoreQueueService;

  // Metrics
  const metrics = {
    incKcEntityResolvePath: vi.fn(),
    observeKcEntityResolveLatencyMs: vi.fn(),
  } as unknown as BusinessMetricsService;

  // Config
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
    // Cache miss.
    m.spies.redisGet.mockResolvedValueOnce(null);
    // Exact SQL вернул найденный id.
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
    // KNN raw SQL НЕ должен быть запущен (только exact-запрос).
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
    // Exact пусто.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    // KNN: distance=0.04 → similarity=0.96 (>= 0.95).
    m.spies.queryRawUnsafe.mockResolvedValueOnce([
      { id: 'ent-knn', distance: 0.04 },
    ]);
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
    expect(m.spies.embedNames).toHaveBeenCalledTimes(1); // embed для KNN
    expect(m.spies.entityCreate).not.toHaveBeenCalled();
    expect(m.spies.enqueueEntityResolver).not.toHaveBeenCalled();
    expect(m.metrics.incKcEntityResolvePath).toHaveBeenCalledWith({
      path: 'knn',
    });
  });

  it('knn miss → create + enqueue entity-resolver + cache write', async () => {
    const m = makeMocks({ threshold: 0.95 });
    m.spies.redisGet.mockResolvedValueOnce(null);
    // Exact пусто.
    m.spies.queryRawUnsafe.mockResolvedValueOnce([]);
    // KNN: distance=0.20 → similarity=0.80 (< 0.95).
    m.spies.queryRawUnsafe.mockResolvedValueOnce([
      { id: 'ent-far', distance: 0.2 },
    ]);

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
