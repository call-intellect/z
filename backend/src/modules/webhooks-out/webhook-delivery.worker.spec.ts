import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { EncryptionService } from '../security/encryption.service';
import type { SsrfGuardService } from '../security/ssrf-guard.service';

import type { SubscriptionsRepository } from './subscriptions.repository';
import type { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhookSigningService } from './webhook-signing.service';

function makeRedis(): RedisService {
  return { client: {} } as unknown as RedisService;
}
function makeCfg(): TypedConfigService {
  return {
    webhooksOut: {
      deliveryTimeoutMs: 1000,
      maxAttempts: 3,
    },
  } as unknown as TypedConfigService;
}
function makeMetrics(): BusinessMetricsService {
  return { incWebhookDelivery: vi.fn() } as unknown as BusinessMetricsService;
}
function makeEncryption(): EncryptionService {
  return { decrypt: () => 'plain_secret' } as unknown as EncryptionService;
}
function makeSsrf(allow = true): SsrfGuardService {
  return {
    assertSafeOutboundUrl: vi.fn(async () => {
      if (!allow) throw new Error('blocked');
      return { url: new URL('https://x'), ipv4: '8.8.8.8' };
    }),
  } as unknown as SsrfGuardService;
}
function makeRepo(state: {
  delivery: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  consecutiveFailed?: number;
}): SubscriptionsRepository {
  return {
    findDelivery: vi.fn(async () => state.delivery),
    findById: vi.fn(async () => state.subscription),
    updateDelivery: vi.fn(async () => undefined),
    updateStatus: vi.fn(async () => undefined),
    countConsecutiveFailed: vi.fn(async () => state.consecutiveFailed ?? 0),
  } as unknown as SubscriptionsRepository;
}
function makeDispatcher(): WebhookDispatcherService {
  return { enqueueRetry: vi.fn(async () => undefined) } as unknown as WebhookDispatcherService;
}

describe('WebhookDeliveryWorker.process', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('2xx → status=delivered, lastDeliveryAt обновлён', async () => {
    const repo = makeRepo({
      delivery: {
        id: 'd1',
        subscriptionId: 's1',
        event: 'meeting.completed',
        eventId: 'evt_1',
        payload: { hello: 'world' },
        attempts: 0,
        status: 'pending',
      },
      subscription: {
        id: 's1',
        url: 'https://example.com/hook',
        secretEncrypted: 'enc',
        status: 'active',
      },
    });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      text: async () => 'ok',
    });
    const metrics = makeMetrics();
    const w = new WebhookDeliveryWorker(
      makeRedis(),
      repo,
      makeEncryption(),
      makeSsrf(),
      new WebhookSigningService(),
      makeDispatcher(),
      makeCfg(),
      metrics,
    );
    await w.process({ data: { deliveryId: 'd1' } } as never);
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ status: 'delivered' }),
    );
    expect(repo.updateStatus).toHaveBeenCalled();
    expect(metrics.incWebhookDelivery).toHaveBeenCalledWith({
      event: 'meeting.completed',
      status: 'delivered',
    });
  });

  it('5xx → retry с экспоненциальным backoff', async () => {
    const dispatcher = makeDispatcher();
    const repo = makeRepo({
      delivery: {
        id: 'd2',
        subscriptionId: 's1',
        event: 'task.created',
        eventId: 'evt_2',
        payload: {},
        attempts: 0,
        status: 'pending',
      },
      subscription: {
        id: 's1',
        url: 'https://x.com/h',
        secretEncrypted: 'enc',
        status: 'active',
      },
    });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 500,
      text: async () => 'oops',
    });
    const metrics = makeMetrics();
    const w = new WebhookDeliveryWorker(
      makeRedis(),
      repo,
      makeEncryption(),
      makeSsrf(),
      new WebhookSigningService(),
      dispatcher,
      makeCfg(),
      metrics,
    );
    await w.process({ data: { deliveryId: 'd2' } } as never);
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      'd2',
      expect.objectContaining({ status: 'retrying' }),
    );
    expect(dispatcher.enqueueRetry).toHaveBeenCalled();
    expect(metrics.incWebhookDelivery).toHaveBeenCalledWith({
      event: 'task.created',
      status: 'retrying',
    });
  });

  it('после maxAttempts — failed, проверка авто-перевода subscription в failing', async () => {
    const dispatcher = makeDispatcher();
    const repo = makeRepo({
      delivery: {
        id: 'd3',
        subscriptionId: 's1',
        event: 'task.created',
        eventId: 'evt_3',
        payload: {},
        attempts: 2, // следующий attempt = 3 = maxAttempts → final fail
        status: 'retrying',
      },
      subscription: {
        id: 's1',
        url: 'https://x.com/h',
        secretEncrypted: 'enc',
        status: 'active',
      },
      consecutiveFailed: 5,
    });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 500,
      text: async () => 'fail',
    });
    const metrics = makeMetrics();
    const w = new WebhookDeliveryWorker(
      makeRedis(),
      repo,
      makeEncryption(),
      makeSsrf(),
      new WebhookSigningService(),
      dispatcher,
      makeCfg(),
      metrics,
    );
    await w.process({ data: { deliveryId: 'd3' } } as never);
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      'd3',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(repo.updateStatus).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'failing' }),
    );
    expect(metrics.incWebhookDelivery).toHaveBeenCalledWith({
      event: 'task.created',
      status: 'failed',
    });
  });

  it('SSRF-блок → status=failed, без HTTP-вызова', async () => {
    const repo = makeRepo({
      delivery: {
        id: 'd4',
        subscriptionId: 's1',
        event: 'meeting.completed',
        eventId: 'e',
        payload: {},
        attempts: 0,
        status: 'pending',
      },
      subscription: {
        id: 's1',
        url: 'http://10.0.0.1/hook',
        secretEncrypted: 'enc',
        status: 'active',
      },
    });
    const w = new WebhookDeliveryWorker(
      makeRedis(),
      repo,
      makeEncryption(),
      makeSsrf(false),
      new WebhookSigningService(),
      makeDispatcher(),
      makeCfg(),
      makeMetrics(),
    );
    await w.process({ data: { deliveryId: 'd4' } } as never);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      'd4',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
