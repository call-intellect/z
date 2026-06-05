import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialContributionPreferenceService } from './social-contribution-preference.service';

/**
 * ТЗ-E Ф4 — unit-тесты SocialContributionPreferenceService.
 *
 * Мок RedisService: in-memory Map под `.client.get/set`. Проверяем round-trip
 * (set → get) и дефолт (нет записи → optedOut=false, updatedAt=null).
 */

function buildMockRedis(): {
  service: { client: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } };
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const service = {
    client: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
  };
  return { service, store };
}

describe('SocialContributionPreferenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trip: set(optedOut=true) → get возвращает true и updatedAt', async () => {
    const { service } = buildMockRedis();
    const svc = new SocialContributionPreferenceService(service as any);

    const setRes = await svc.set('org1', 'u1', true);
    expect(setRes.optedOut).toBe(true);
    expect(typeof setRes.updatedAt).toBe('string');

    const getRes = await svc.get('org1', 'u1');
    expect(getRes.optedOut).toBe(true);
    expect(getRes.updatedAt).toBe(setRes.updatedAt);
  });

  it('round-trip: set(optedOut=false) → get возвращает false', async () => {
    const { service } = buildMockRedis();
    const svc = new SocialContributionPreferenceService(service as any);

    await svc.set('org1', 'u1', false);
    const getRes = await svc.get('org1', 'u1');
    expect(getRes.optedOut).toBe(false);
    expect(typeof getRes.updatedAt).toBe('string');
  });

  it('дефолт: нет записи → optedOut=false, updatedAt=null', async () => {
    const { service } = buildMockRedis();
    const svc = new SocialContributionPreferenceService(service as any);

    const getRes = await svc.get('org1', 'u_never_set');
    expect(getRes.optedOut).toBe(false);
    expect(getRes.updatedAt).toBeNull();
  });

  it('ключ изолирован по tenant+user', async () => {
    const { service, store } = buildMockRedis();
    const svc = new SocialContributionPreferenceService(service as any);

    await svc.set('org1', 'u1', true);
    expect(store.has('helpfulness:optout:org1:u1')).toBe(true);

    // Другой tenant / user — дефолт, не пересекается.
    const other = await svc.get('org2', 'u1');
    expect(other.optedOut).toBe(false);
    const otherUser = await svc.get('org1', 'u2');
    expect(otherUser.optedOut).toBe(false);
  });

  it('битый JSON → graceful дефолт (optedOut=false, updatedAt=null)', async () => {
    const { service, store } = buildMockRedis();
    const svc = new SocialContributionPreferenceService(service as any);
    store.set('helpfulness:optout:org1:u1', 'not-a-json');

    const getRes = await svc.get('org1', 'u1');
    expect(getRes.optedOut).toBe(false);
    expect(getRes.updatedAt).toBeNull();
  });
});
