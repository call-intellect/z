import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import { ProbeService } from './probe.service';

function makeService(over?: {
  coldStartModeHours?: number;
  earliestProbeAgeHours?: number | null;
  embedResult?: number[] | 'throw';
  semanticRows?: Array<{ id: string; distance: number }>;
  dynamicOverrides?: Record<string, unknown>;
}): {
  service: ProbeService;
  create: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  incProbeEvent: ReturnType<typeof vi.fn>;
  incProbeDedupDropped: ReturnType<typeof vi.fn>;
  embed: ReturnType<typeof vi.fn>;
  queryRawUnsafe: ReturnType<typeof vi.fn>;
  executeRawUnsafe: ReturnType<typeof vi.fn>;
} {
  const create = vi
    .fn()
    .mockImplementation(async (args: { data: { status: string } }) => ({
      id: 'probe-new-1',
      ...args.data,
    }));
  const earliestAge = over?.earliestProbeAgeHours ?? null;
  const findFirst = vi.fn().mockResolvedValue(
    earliestAge == null
      ? null
      : { createdAt: new Date(Date.now() - earliestAge * 3600 * 1000) },
  );
  const queryRawUnsafe = vi
    .fn()
    .mockResolvedValue(over?.semanticRows ?? []);
  const executeRawUnsafe = vi.fn().mockResolvedValue(1);
  const prisma = {
    probeEvent: { create, findFirst },
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
  } as unknown as PrismaService;

  const redis = {
    client: {
      set: vi.fn().mockResolvedValue('1'),
      get: vi.fn().mockResolvedValue(null),
    },
  } as unknown as RedisService;

  const enqueue = vi.fn().mockResolvedValue(undefined);
  const queue = {
    enqueueProbeEvent: enqueue,
  } as unknown as CoreQueueService;

  const cfg = {
    probe: {
      dedupTtlHours: 24,
      rateLimitPerHour: 5,
      rateLimitPerDay: 20,
      expiryDays: 14,
      coldStartModeHours: over?.coldStartModeHours ?? 0,
    },
    getDynamic: vi
      .fn()
      .mockImplementation(async (key: string, _env, def: unknown) =>
        over?.dynamicOverrides && key in over.dynamicOverrides
          ? over.dynamicOverrides[key]
          : def,
      ),
  } as unknown as TypedConfigService;

  const embed = vi.fn().mockImplementation(async () => {
    if (over?.embedResult === 'throw') {
      throw new Error('embed boom');
    }
    return [over?.embedResult ?? [0.1, 0.2, 0.3]];
  });
  const embeddings = { embed } as unknown as EmbeddingFallbackService;

  const incProbeEvent = vi.fn();
  const incProbeDedupDropped = vi.fn();
  const metrics = {
    incProbeEvent,
    incProbeRateLimitDropped: vi.fn(),
    incProbeDedupDropped,
    incProbeColdStartDropped: vi.fn(),
  } as unknown as BusinessMetricsService;

  return {
    service: new ProbeService(prisma, redis, queue, cfg, metrics, embeddings),
    create,
    enqueue,
    incProbeEvent,
    incProbeDedupDropped,
    embed,
    queryRawUnsafe,
    executeRawUnsafe,
  };
}

describe('ProbeService.suggest — W2 гейт ценности + NUDGE + cold-start', () => {
  let env: ReturnType<typeof makeService>;

  beforeEach(() => {
    env = makeService();
  });

  it('priority 20 < minValuePriority 30 → dropped_low_value, без enqueue', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-6-ideas',
      reason: 'idea.status_unclear',
      payload: { message: 'Малоценный вопрос' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.2,
    });

    expect('dropped' in res && res.dropped).toBe('low_value');
    const created = env.create.mock.calls[0]![0] as {
      data: { status: string; priority: number };
    };
    expect(created.data.status).toBe('dropped_low_value');
    expect(created.data.priority).toBe(20);
    expect(env.enqueue).not.toHaveBeenCalled();
    expect(env.incProbeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dropped_low_value' }),
    );
  });

  it('NUDGE-reason (commitment.followup, priority 50) → routed_to_digest, без enqueue', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-3-decisions',
      reason: 'commitment.followup',
      payload: { message: 'Напоминание по обещанию' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = env.create.mock.calls[0]![0] as {
      data: { status: string; expiresAt?: Date };
    };
    expect(created.data.status).toBe('routed_to_digest');
    expect(created.data.expiresAt).toBeInstanceOf(Date);
    expect(created.data.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(env.enqueue).not.toHaveBeenCalled();
  });

  it('обычный immediate reason priority 50 → pending + enqueue dispatcher', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { message: 'У регламента нет владельца' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = env.create.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(created.data.status).toBe('pending');
    expect(env.enqueue).toHaveBeenCalledTimes(1);
  });

  it('cold-start: первый probe СТАРШЕ окна (48ч > 24ч) → не дроп, идёт pending', async () => {
    const e = makeService({ coldStartModeHours: 24, earliestProbeAgeHours: 48 });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { message: 'Окно прогрева прошло' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('pending');
  });

  it('cold-start: первый probe В ОКНЕ (1ч < 24ч) → routed_to_digest (L-3: вопросы нового Org не теряются)', async () => {
    const e = makeService({ coldStartModeHours: 24, earliestProbeAgeHours: 1 });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { message: 'Свежий граф — копим' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as {
      data: { status: string; priority: number; expiresAt?: Date };
    };
    expect(created.data.status).toBe('routed_to_digest');
    expect(created.data.priority).toBe(50);
    expect(created.data.expiresAt).toBeInstanceOf(Date);
    expect(e.incProbeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'routed_to_digest' }),
    );
    expect(e.enqueue).not.toHaveBeenCalled();
  });
});

describe('ProbeService.suggest — Ф4 семантический дедуп вопросов (pgvector)', () => {
  it('близкий вектор (distance 0.05 → sim 0.95 ≥ 0.92) → dropped:dedup + метрика', async () => {
    const e = makeService({
      semanticRows: [{ id: 'probe-near', distance: 0.05 }],
    });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { suggestedQuestion: 'Кто отвечает за это решение?' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('dropped' in res && res.dropped).toBe('dedup');
    expect(e.embed).toHaveBeenCalledTimes(1);
    expect(e.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(e.incProbeDedupDropped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'regulation.missing_owner' }),
    );
    expect(e.incProbeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dropped_dedup' }),
    );
    expect(e.create).not.toHaveBeenCalled();
    expect(e.enqueue).not.toHaveBeenCalled();
  });

  it('далёкий вектор (distance 0.30 → sim 0.70 < 0.92) → проходит дальше (pending)', async () => {
    const e = makeService({
      semanticRows: [{ id: 'probe-far', distance: 0.3 }],
    });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { suggestedQuestion: 'Совсем другой вопрос про дедлайн' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('pending');
    expect(e.incProbeDedupDropped).not.toHaveBeenCalled();
    expect(e.executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('questionEmbedding'),
      expect.stringContaining('['),
      'probe-new-1',
    );
  });

  it('пустой результат KNN → проходит дальше (pending), не дроп по семантике', async () => {
    const e = makeService({ semanticRows: [] });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { suggestedQuestion: 'Первый вопрос в окне' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    expect(e.queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(e.incProbeDedupDropped).not.toHaveBeenCalled();
  });

  it('флаг semanticDedupEnabled OFF → семантика не применяется (embed/KNN не зван)', async () => {
    const e = makeService({
      dynamicOverrides: { 'probe.semanticDedupEnabled': false },
      semanticRows: [{ id: 'probe-near', distance: 0.01 }],
    });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { suggestedQuestion: 'Вопрос при выключенной семантике' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('pending');
    expect(e.embed).not.toHaveBeenCalled();
    expect(e.queryRawUnsafe).not.toHaveBeenCalled();
    expect(e.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('embed кинул ошибку → graceful, probe проходит (pending), без падения', async () => {
    const e = makeService({ embedResult: 'throw' });
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { suggestedQuestion: 'Вопрос при упавшем embed' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as { data: { status: string } };
    expect(created.data.status).toBe('pending');
    expect(e.embed).toHaveBeenCalledTimes(1);
    expect(e.queryRawUnsafe).not.toHaveBeenCalled();
    expect(e.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('нет текста вопроса (ни suggestedQuestion, ни message) → семантика пропущена', async () => {
    const e = makeService();
    const res = await e.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner',
      payload: { contextCardId: 'card-1' },
      recipientCandidates: ['user-1'],
      priorityHint: 0.5,
    });

    expect('ok' in res && res.ok).toBe(true);
    expect(e.embed).not.toHaveBeenCalled();
    expect(e.queryRawUnsafe).not.toHaveBeenCalled();
  });
});
