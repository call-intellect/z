import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { WebhookDeliveryJobData } from '../queues';
import { WebhookSigner } from '../services/webhook-signer.service';

import { WebhookDeliveryWorker } from './webhook-delivery.worker';

/**
 * Юнит-тест worker'а. Не запускаем BullMQ — вызываем приватный `process`
 * напрямую, чтобы изолировать логику от Redis.
 */
describe('WebhookDeliveryWorker — process', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let metrics: BusinessMetricsService;
  let signer: WebhookSigner;
  let worker: WebhookDeliveryWorker;
  let findFirstMock: ReturnType<typeof vi.fn>;
  let logCreateMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findFirstMock = vi.fn();
    logCreateMock = vi.fn(async () => ({ id: 'log1' }));
    prisma = {
      issueWebhook: {
        findFirst: findFirstMock,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      issueWebhookLog: { create: logCreateMock },
    } as unknown as PrismaService;
    redis = { client: {} } as unknown as RedisService;
    metrics = {
      incWebhookDelivery: vi.fn(),
    } as unknown as BusinessMetricsService;
    signer = new WebhookSigner();
    worker = new WebhookDeliveryWorker(redis, prisma, signer, metrics);

    fetchMock = vi.fn();
    // node fetch — глобал.
    vi.stubGlobal('fetch', fetchMock);
  });

  function makeJob(attemptsMade = 0): {
    id: string;
    data: WebhookDeliveryJobData;
    attemptsMade: number;
    opts: { attempts: number };
  } {
    return {
      id: 'job123',
      data: {
        webhookId: 'wh1',
        tenantId: 't1',
        eventType: 'issue.created',
        payload: { foo: 'bar' },
        enqueuedAt: '2026-05-24T10:00:00Z',
      },
      attemptsMade,
      opts: { attempts: 5 },
    };
  }

  it('успешная доставка (200) → пишет log success=true, success без throw', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'wh1',
      tenantId: 't1',
      url: 'https://example.test/webhook',
      secretKey: 'kora_wh_secret_value',
      isActive: true,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'ok',
      headers: new Headers(),
    });

    const job = makeJob();
    // @ts-expect-error — приватный метод, доступен для тестов.
    await worker.process(job);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.test/webhook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-kora-event']).toBe('issue.created');
    expect(opts.headers['x-kora-webhook-id']).toBe('wh1');
    expect(opts.headers['x-kora-delivery']).toBe('job123');
    expect(opts.headers['x-kora-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

    expect(logCreateMock).toHaveBeenCalledTimes(1);
    const logData = logCreateMock.mock.calls[0]![0].data;
    expect(logData.success).toBe(true);
    expect(logData.responseStatus).toBe(200);
    expect(logData.errorMessage).toBeNull();
    expect(logData.retryCount).toBe(0);
  });

  it('500-ответ → пишет log success=false и throw (для retry BullMQ)', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'wh1',
      tenantId: 't1',
      url: 'https://example.test/webhook',
      secretKey: 'kora_wh_secret_value',
      isActive: true,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'internal',
      headers: new Headers(),
    });

    const job = makeJob(1); // вторая попытка
    // @ts-expect-error — приватный метод.
    await expect(worker.process(job)).rejects.toThrow(/HTTP 500/);

    expect(logCreateMock).toHaveBeenCalledTimes(1);
    const logData = logCreateMock.mock.calls[0]![0].data;
    expect(logData.success).toBe(false);
    expect(logData.responseStatus).toBe(500);
    expect(logData.errorMessage).toBe('HTTP 500');
    expect(logData.retryCount).toBe(1);
  });

  it('webhook deactivated после создания job — пропуск (no throw, no fetch)', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'wh1',
      tenantId: 't1',
      url: 'https://example.test/webhook',
      secretKey: 'kora_wh_secret_value',
      isActive: false,
    });

    const job = makeJob();
    // @ts-expect-error — приватный метод.
    await worker.process(job);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logCreateMock).not.toHaveBeenCalled();
  });

  it('webhook удалён — пропуск (no throw)', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const job = makeJob();
    // @ts-expect-error — приватный метод.
    await worker.process(job);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logCreateMock).not.toHaveBeenCalled();
  });

  it('AbortError при timeout → log с errorMessage timeout', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'wh1',
      tenantId: 't1',
      url: 'https://example.test/slow',
      secretKey: 'kora_wh_secret_value',
      isActive: true,
    });
    fetchMock.mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const job = makeJob();
    // @ts-expect-error — приватный метод.
    await expect(worker.process(job)).rejects.toThrow();
    const logData = logCreateMock.mock.calls[0]![0].data;
    expect(logData.success).toBe(false);
    expect(logData.errorMessage).toMatch(/^timeout/);
    expect(logData.responseStatus).toBeNull();
  });
});
