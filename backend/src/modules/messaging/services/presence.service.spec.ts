import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { RedisService } from '../../../common/redis/redis.service';

import { PresenceService } from './presence.service';

function makeRedisClient() {
  const store = new Map<string, Map<string, string>>();
  const client = {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      const h = store.get(key) ?? new Map<string, string>();
      h.set(field, value);
      store.set(key, h);
      return 1;
    }),
    hgetall: vi.fn(async (key: string) => {
      const h = store.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    }),
    hdel: vi.fn(async (key: string, ...fields: string[]) => {
      const h = store.get(key);
      if (!h) return 0;
      let n = 0;
      for (const f of fields) if (h.delete(f)) n++;
      return n;
    }),
    pexpire: vi.fn(async () => 1),
  };
  return { client, store };
}

function makeCfg(ttlSeconds = 60) {
  return {
    getDynamic: vi.fn().mockResolvedValue(ttlSeconds),
  } as unknown as TypedConfigService & { getDynamic: ReturnType<typeof vi.fn> };
}

describe('PresenceService (Redis-TTL)', () => {
  let redisMock: ReturnType<typeof makeRedisClient>;
  let redis: RedisService;

  beforeEach(() => {
    redisMock = makeRedisClient();
    redis = { client: redisMock.client } as unknown as RedisService;
  });

  it('join пишет в Redis hash (hset вызван), не в in-process', async () => {
    const service = new PresenceService(redis, makeCfg());
    await service.join({ conversationId: 'conv-1', userId: 'u1', displayName: 'Alice' });

    expect(redisMock.client.hset).toHaveBeenCalledTimes(1);
    const [key, field] = redisMock.client.hset.mock.calls[0]!;
    expect(key).toBe('presence:conv:conv-1');
    expect(field).toBe('u1');
    expect(redisMock.client.pexpire).toHaveBeenCalled();
  });

  it('collect читает из Redis — свежий процесс (новый PresenceService) видит presence из Redis (переживёт рестарт)', async () => {
    const writer = new PresenceService(redis, makeCfg());
    await writer.join({ conversationId: 'conv-1', userId: 'u1', displayName: 'Alice' });

    const freshProcess = new PresenceService(redis, makeCfg());
    const online = await freshProcess.collect('conv-1');

    expect(online).toEqual([{ userId: 'u1', displayName: 'Alice' }]);
    expect(redisMock.client.hgetall).toHaveBeenCalledWith('presence:conv:conv-1');
  });

  it('TTL: просроченные (expiresAt<now) не попадают в collect и чистятся (hdel)', async () => {
    redisMock.store.set(
      'presence:conv:conv-1',
      new Map([
        ['stale', JSON.stringify({ displayName: 'Old', expiresAt: Date.now() - 1000 })],
        ['fresh', JSON.stringify({ displayName: 'New', expiresAt: Date.now() + 60_000 })],
      ]),
    );
    const service = new PresenceService(redis, makeCfg());

    const online = await service.collect('conv-1');

    expect(online).toEqual([{ userId: 'fresh', displayName: 'New' }]);
    expect(redisMock.client.hdel).toHaveBeenCalledWith('presence:conv:conv-1', 'stale');
  });

  it('leave удаляет запись из Redis (hdel)', async () => {
    const service = new PresenceService(redis, makeCfg());
    await service.leave({ conversationId: 'conv-1', userId: 'u1' });

    expect(redisMock.client.hdel).toHaveBeenCalledWith('presence:conv:conv-1', 'u1');
  });
});
