/**
 * W2 autonomy (2026-06-12) — ProbeService.suggest: гейт ценности
 * (dropped_low_value), NUDGE-реклассификация (routed_to_digest) и включённый
 * cold-start (окно прогрева после первого probe в Org).
 *
 * Детерминизм: Redis/Prisma/Queue/Cfg/Metrics мокированы (стиль
 * probe-service-queued-digest.spec.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import { ProbeService } from './probe.service';

function makeService(over?: {
  coldStartModeHours?: number;
  earliestProbeAgeHours?: number | null;
}): {
  service: ProbeService;
  create: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  incProbeEvent: ReturnType<typeof vi.fn>;
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
  const prisma = {
    probeEvent: { create, findFirst },
  } as unknown as PrismaService;

  const redis = {
    client: {
      // dedup SET NX → '1' (не дубль); GET → null (бюджет свободен,
      // cooldown/engagement отсутствуют).
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
    // getDynamic возвращает default: adaptiveFatigue=true, minValuePriority=30.
    getDynamic: vi
      .fn()
      .mockImplementation(async (_key: string, _env, def: unknown) => def),
  } as unknown as TypedConfigService;

  const incProbeEvent = vi.fn();
  const metrics = {
    incProbeEvent,
    incProbeRateLimitDropped: vi.fn(),
    incProbeDedupDropped: vi.fn(),
    incProbeColdStartDropped: vi.fn(),
  } as unknown as BusinessMetricsService;

  return {
    service: new ProbeService(prisma, redis, queue, cfg, metrics),
    create,
    enqueue,
    incProbeEvent,
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
      priorityHint: 0.2, // → priority 20
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
      priorityHint: 0.5, // → priority 50 ≥ 30 (гейт ценности пройден)
    });

    expect('ok' in res && res.ok).toBe(true);
    const created = env.create.mock.calls[0]![0] as {
      data: { status: string; expiresAt?: Date };
    };
    expect(created.data.status).toBe('routed_to_digest');
    // L-2 — digest-статус получает expiresAt (тот же расчёт, что у pending).
    expect(created.data.expiresAt).toBeInstanceOf(Date);
    expect(created.data.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    // Дайджест-cron подберёт — dispatcher НЕ ставится в очередь.
    expect(env.enqueue).not.toHaveBeenCalled();
  });

  it('обычный immediate reason priority 50 → pending + enqueue dispatcher', async () => {
    const res = await env.service.suggest({
      tenantId: 'org-1',
      emittedByService: '3-1-regulations',
      reason: 'regulation.missing_owner', // immediate, не NUDGE
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

    // L-3 — не терминальный drop, а отложка: придёт дайджестом после прогрева.
    expect('ok' in res && res.ok).toBe(true);
    const created = e.create.mock.calls[0]![0] as {
      data: { status: string; priority: number; expiresAt?: Date };
    };
    expect(created.data.status).toBe('routed_to_digest');
    expect(created.data.priority).toBe(50);
    // L-2 — digest-статус стареет (expiresAt задан).
    expect(created.data.expiresAt).toBeInstanceOf(Date);
    // Метрика идёт со status='routed_to_digest', не dropped_cold_start.
    expect(e.incProbeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'routed_to_digest' }),
    );
    expect(e.enqueue).not.toHaveBeenCalled();
  });
});
