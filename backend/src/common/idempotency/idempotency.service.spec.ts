import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../config/index';
import type { RedisService } from '../redis/redis.service';

import { IdempotencyService } from './idempotency.service';

/**
 * Юнит-тест IdempotencyService:
 *   - формула ключа: `idempotency:${tenantId ?? 'global'}:${key}`;
 *   - setCached → SET ... EX <ttl>;
 *   - getCached → JSON.parse;
 *   - fail-open на ошибках Redis (возвращаем null / не падаем).
 */
describe('IdempotencyService', () => {
  let getMock: ReturnType<typeof vi.fn>;
  let setMock: ReturnType<typeof vi.fn>;
  let service: IdempotencyService;

  beforeEach(() => {
    getMock = vi.fn();
    setMock = vi.fn().mockResolvedValue('OK');

    const redis = {
      client: { get: getMock, set: setMock },
    } as unknown as RedisService;

    const cfg = {
      tracker: { idempotencyKeyTtlSeconds: 86_400 },
    } as unknown as TypedConfigService;

    service = new IdempotencyService(redis, cfg);
  });

  it('buildKey — формат `idempotency:<tenantId>:<key>`', () => {
    expect(service.buildKey('abc-123', 'org_42')).toBe('idempotency:org_42:abc-123');
  });

  it('buildKey — tenantId=null → префикс `global`', () => {
    expect(service.buildKey('abc-123', null)).toBe('idempotency:global:abc-123');
  });

  it('buildKey — tenantId="" (пустая строка) → префикс `global`', () => {
    expect(service.buildKey('abc-123', '')).toBe('idempotency:global:abc-123');
  });

  it('setCached — пишет JSON с TTL из config (default 86400)', async () => {
    await service.setCached('k1', 'org_1', { status: 201, body: { ok: true } });
    expect(setMock).toHaveBeenCalledTimes(1);
    const [redisKey, value, exFlag, ttl] = setMock.mock.calls[0]!;
    expect(redisKey).toBe('idempotency:org_1:k1');
    expect(JSON.parse(value as string)).toEqual({
      status: 201,
      body: { ok: true },
    });
    expect(exFlag).toBe('EX');
    expect(ttl).toBe(86_400);
  });

  it('setCached — кастомный TTL переопределяет дефолт', async () => {
    await service.setCached('k2', null, { status: 200, body: {} }, 120);
    expect(setMock).toHaveBeenCalledTimes(1);
    const [, , , ttl] = setMock.mock.calls[0]!;
    expect(ttl).toBe(120);
  });

  it('setCached — нечисловой/нулевой TTL → нижняя граница 1 сек (защита от 0)', async () => {
    await service.setCached('k3', null, { status: 200, body: {} }, 0);
    const [, , , ttl] = setMock.mock.calls[0]!;
    expect(ttl).toBe(1);
  });

  it('getCached — HIT возвращает разобранный JSON', async () => {
    getMock.mockResolvedValueOnce(
      JSON.stringify({ status: 201, body: { id: 'issue_1' } }),
    );
    const result = await service.getCached('k1', 'org_1');
    expect(result).toEqual({ status: 201, body: { id: 'issue_1' } });
    expect(getMock).toHaveBeenCalledWith('idempotency:org_1:k1');
  });

  it('getCached — MISS возвращает null', async () => {
    getMock.mockResolvedValueOnce(null);
    const result = await service.getCached('k2', 'org_2');
    expect(result).toBeNull();
  });

  it('getCached — ошибка Redis → null (fail-open, без throw)', async () => {
    getMock.mockRejectedValueOnce(new Error('connection refused'));
    const result = await service.getCached('k3', null);
    expect(result).toBeNull();
  });

  it('setCached — ошибка Redis → не пробрасывается (fail-open)', async () => {
    setMock.mockRejectedValueOnce(new Error('readonly replica'));
    // Не должно throw'ить.
    await expect(
      service.setCached('k4', null, { status: 200, body: {} }),
    ).resolves.toBeUndefined();
  });

  it('изоляция tenant: один key + разные tenantId → разные ключи Redis', async () => {
    await service.setCached('shared-key', 'org_A', { status: 200, body: { a: 1 } });
    await service.setCached('shared-key', 'org_B', { status: 200, body: { b: 2 } });
    expect(setMock).toHaveBeenCalledTimes(2);
    const keyA = setMock.mock.calls[0]![0];
    const keyB = setMock.mock.calls[1]![0];
    expect(keyA).toBe('idempotency:org_A:shared-key');
    expect(keyB).toBe('idempotency:org_B:shared-key');
    expect(keyA).not.toBe(keyB);
  });
});
