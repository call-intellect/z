import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import { ProbeService } from './probe.service';

function makeService(
  getImpl: (key: string) => Promise<string | null> | string | null,
  adaptiveEnabled = true,
): ProbeService {
  const redis = {
    client: {
      get: vi.fn().mockImplementation(async (key: string) => getImpl(key)),
      set: vi.fn().mockResolvedValue('1'),
    },
  } as unknown as RedisService;
  const cfg = {
    probe: {
      rateLimitPerHour: 5,
      rateLimitPerDay: 20,
      dedupTtlHours: 24,
      expiryDays: 14,
      coldStartModeHours: 0,
    },
    getDynamic: vi.fn().mockResolvedValue(adaptiveEnabled),
  } as unknown as TypedConfigService;
  const prisma = {
    probeEvent: {
      create: vi.fn().mockResolvedValue({ id: 'p1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // Ф4 — семантический дедуп: KNN пуст (нет соседей), запись эмбеддинга — no-op.
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  } as unknown as PrismaService;
  const queue = {
    enqueueProbeEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as CoreQueueService;
  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeRateLimitDropped: vi.fn(),
    incProbeDedupDropped: vi.fn(),
    incProbeColdStartDropped: vi.fn(),
  } as unknown as BusinessMetricsService;
  // Ф4 — embedding-сервис: фиксированный вектор.
  const embeddings = {
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  } as unknown as EmbeddingFallbackService;
  return new ProbeService(prisma, redis, queue, cfg, metrics, embeddings);
}

describe('ProbeService.filterByRateLimit — adaptive fatigue', () => {
  it('низкий engagement → урезанный бюджет → получатель отфильтрован', async () => {
    const s = makeService((key) => {
      if (key.includes(':ratelimit:')) return '3';
      if (key.includes('probe:engagement:')) return '0.1';
      return null;
    });
    expect(await s.filterByRateLimit(['user-low'])).toEqual([]);
  });

  it('высокий engagement → полный бюджет → получатель проходит', async () => {
    const s = makeService((key) => {
      if (key.includes(':ratelimit:')) return '3';
      if (key.includes('probe:engagement:')) return '0.9';
      return null;
    });
    expect(await s.filterByRateLimit(['user-high'])).toEqual(['user-high']);
  });

  it('adaptiveFatigue выключен → engagement игнорируется (полный бюджет)', async () => {
    const s = makeService((key) => {
      if (key.includes(':ratelimit:')) return '3';
      if (key.includes('probe:engagement:')) return '0.05';
      return null;
    }, false);
    expect(await s.filterByRateLimit(['u'])).toEqual(['u']);
  });
});

describe('ProbeService.suggest — topic cooldown', () => {
  it('тема на cooldown → drop (dedup)', async () => {
    const s = makeService((key) => (key.includes(':cooldown:') ? '1' : null));
    const res = await s.suggest({
      tenantId: 'org-1',
      emittedByService: '3-6-ideas',
      reason: 'idea.status_unclear',
      payload: { message: 'Идея зависла' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.4,
    });
    expect('dropped' in res && res.dropped).toBe('dedup');
  });

  it('тема не на cooldown → проходит дальше (cooldown не дропает)', async () => {
    const s = makeService((key) => {
      if (key.includes(':cooldown:')) return null;
      if (key.includes(':ratelimit:')) return null;
      return null;
    });
    const res = await s.suggest({
      tenantId: 'org-1',
      emittedByService: '3-6-ideas',
      reason: 'idea.status_unclear',
      payload: { message: 'Идея зависла' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.4,
    });
    expect('ok' in res && res.ok).toBe(true);
  });
});
