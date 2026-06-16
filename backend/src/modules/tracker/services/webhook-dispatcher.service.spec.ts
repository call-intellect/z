import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { WebhookDispatcher } from './webhook-dispatcher.service';

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher;
  let findManyMock: ReturnType<typeof vi.fn>;
  let addJobMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findManyMock = vi.fn();
    addJobMock = vi.fn(async (_name: string) => ({ id: `job_${addJobMock.mock.calls.length}` }));

    const prisma = {
      issueWebhook: { findMany: findManyMock },
    } as unknown as PrismaService;

    const redis = { client: {} } as unknown as RedisService;

    dispatcher = new WebhookDispatcher(redis, prisma);

    Object.defineProperty(dispatcher, 'queue', {
      value: { add: addJobMock, close: vi.fn() },
      writable: true,
    });
  });

  it('dispatch — фильтрует по tenant + isActive + events.has(eventType)', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'wh_1', name: 'wh-one', allowedDataClasses: ['public', 'internal'] },
      { id: 'wh_2', name: 'wh-two', allowedDataClasses: ['public', 'internal'] },
    ]);
    const ids = await dispatcher.dispatch('org_1', 'issue.created', { foo: 'bar' });
    expect(ids).toEqual(['job_1', 'job_2']);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        tenantId: 'org_1',
        isActive: true,
        events: { has: 'issue.created' },
      },
      select: { id: true, name: true, allowedDataClasses: true },
    });
    expect(addJobMock).toHaveBeenCalledTimes(2);
    const firstCall = addJobMock.mock.calls[0]!;
    expect(firstCall[0]).toBe('issue.created');
    expect(firstCall[1].webhookId).toBe('wh_1');
    expect(firstCall[1].tenantId).toBe('org_1');
    expect(firstCall[1].eventType).toBe('issue.created');
    expect(firstCall[1].payload).toEqual({ foo: 'bar' });
    expect(typeof firstCall[1].enqueuedAt).toBe('string');
  });

  it('dispatch — нет подписчиков → пустой массив, addJob не вызывается', async () => {
    findManyMock.mockResolvedValueOnce([]);
    const ids = await dispatcher.dispatch('org_2', 'cycle.completed', {});
    expect(ids).toEqual([]);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  it('dispatchTest — кладёт один job с attempts:1', async () => {
    const id = await dispatcher.dispatchTest({
      webhookId: 'wh_xyz',
      tenantId: 'org_3',
    });
    expect(id).toBe('job_1');
    const [name, data, opts] = addJobMock.mock.calls[0]!;
    expect(name).toBe('webhook.test');
    expect(data.webhookId).toBe('wh_xyz');
    expect(data.eventType).toBe('webhook.test');
    expect(opts.attempts).toBe(1);
  });

  it('dispatch — возвращает [] и не падает, если очередь ещё не инициализирована', async () => {
    Object.defineProperty(dispatcher, 'queue', {
      value: null,
      writable: true,
    });
    const ids = await dispatcher.dispatch('org_1', 'issue.created', {});
    expect(ids).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
