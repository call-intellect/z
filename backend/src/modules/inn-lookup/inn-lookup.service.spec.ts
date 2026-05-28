/**
 * Unit-тесты InnLookupService.
 *
 * Покрытие:
 *   - provider=mock → MockAdapter, DadataAdapter не зовётся
 *   - provider=dadata → DadataAdapter, MockAdapter не зовётся
 *   - provider=tochka_then_dadata (Фаза 2 ≡ dadata) → DadataAdapter
 *   - Кэш hit → cached=true, провайдер не зовётся
 *   - Cache write после первого miss
 *   - Lock SET NX EX срабатывает при miss
 *   - Все источники молчат → NotFoundException
 *   - Невалидный ИНН → throw
 *   - invalidate(inn) → keys() + del()
 */

import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { RedisService } from '../../common/redis/redis.service';

import type { DadataAdapter } from './adapters/dadata.adapter';
import type { InnLookupResult } from './adapters/inn-lookup.adapter';
import type { MockAdapter } from './adapters/mock.adapter';
import type { TochkaOpenBankingAdapter } from './adapters/tochka.adapter';
import { InnLookupService } from './inn-lookup.service';

interface FakeRedis {
  client: {
    keys: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
}

function makeRedis(): FakeRedis {
  return {
    client: {
      keys: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeCfg(
  provider: 'mock' | 'dadata' | 'tochka_then_dadata',
  ttlDays = 30,
): TypedConfigService {
  return {
    billing: {
      innLookup: { provider, cacheTtlDays: ttlDays },
      dadata: { apiKey: 'test', isConfigured: true },
    },
  } as unknown as TypedConfigService;
}

function makeAdapter(
  name: 'mock' | 'dadata' | 'tochka',
  result: InnLookupResult | null,
) {
  return {
    name,
    lookup: vi.fn().mockResolvedValue(result),
  };
}

const SBER: InnLookupResult = {
  source: 'mock',
  payerType: 'legal_entity',
  legalName: 'ПАО Сбербанк',
  inn: '7707083893',
  kpp: '773601001',
  ogrn: '1027700132195',
  legalAddress: 'г. Москва',
  directorName: null,
  bankBik: null,
  bankAccount: null,
};

describe('InnLookupService', () => {
  let redis: FakeRedis;
  let mockAdapter: ReturnType<typeof makeAdapter>;
  let dadataAdapter: ReturnType<typeof makeAdapter>;
  let tochkaAdapter: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    redis = makeRedis();
    mockAdapter = makeAdapter('mock', SBER);
    dadataAdapter = makeAdapter('dadata', { ...SBER, source: 'dadata' });
    // По умолчанию Tochka возвращает null — DaData fallback срабатывает.
    // В тестах tochka_then_dadata переопределяем mockResolvedValueOnce.
    tochkaAdapter = makeAdapter('tochka', null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeService(
    provider: 'mock' | 'dadata' | 'tochka_then_dadata' = 'mock',
  ) {
    return new InnLookupService(
      makeCfg(provider),
      redis as unknown as RedisService,
      mockAdapter as unknown as MockAdapter,
      dadataAdapter as unknown as DadataAdapter,
      tochkaAdapter as unknown as TochkaOpenBankingAdapter,
    );
  }

  it('provider=mock → MockAdapter, DadataAdapter не зовётся', async () => {
    const svc = makeService('mock');
    const result = await svc.lookup('7707083893');
    expect(result.source).toBe('mock');
    expect(result.cached).toBe(false);
    expect(mockAdapter.lookup).toHaveBeenCalledWith('7707083893');
    expect(dadataAdapter.lookup).not.toHaveBeenCalled();
  });

  it('provider=dadata → DadataAdapter, MockAdapter не зовётся', async () => {
    const svc = makeService('dadata');
    const result = await svc.lookup('7707083893');
    expect(result.source).toBe('dadata');
    expect(dadataAdapter.lookup).toHaveBeenCalled();
    expect(mockAdapter.lookup).not.toHaveBeenCalled();
  });

  it('provider=tochka_then_dadata: Tochka null → DaData fallback', async () => {
    // tochkaAdapter по умолчанию возвращает null (см. beforeEach)
    const svc = makeService('tochka_then_dadata');
    const result = await svc.lookup('7707083893');
    expect(result.source).toBe('dadata');
    expect(tochkaAdapter.lookup).toHaveBeenCalledWith('7707083893');
    expect(dadataAdapter.lookup).toHaveBeenCalled();
  });

  it('provider=tochka_then_dadata: Tochka вернул данные → DaData НЕ зовётся', async () => {
    tochkaAdapter.lookup.mockResolvedValueOnce({ ...SBER, source: 'tochka' });
    const svc = makeService('tochka_then_dadata');
    const result = await svc.lookup('7707083893');
    expect(result.source).toBe('tochka');
    expect(tochkaAdapter.lookup).toHaveBeenCalled();
    expect(dadataAdapter.lookup).not.toHaveBeenCalled();
  });

  it('provider=tochka_then_dadata: Tochka throw → DaData fallback (graceful)', async () => {
    tochkaAdapter.lookup.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const svc = makeService('tochka_then_dadata');
    const result = await svc.lookup('7707083893');
    expect(result.source).toBe('dadata');
    expect(dadataAdapter.lookup).toHaveBeenCalled();
  });

  it('кэш hit → cached=true, провайдер НЕ зовётся', async () => {
    redis.client.keys.mockResolvedValueOnce(['inn-lookup:mock:7707083893']);
    redis.client.get.mockResolvedValueOnce(JSON.stringify(SBER));

    const svc = makeService('mock');
    const result = await svc.lookup('7707083893');

    expect(result.cached).toBe(true);
    expect(result.source).toBe('mock');
    expect(mockAdapter.lookup).not.toHaveBeenCalled();
    expect(dadataAdapter.lookup).not.toHaveBeenCalled();
  });

  it('после miss пишет результат в кэш с TTL по конфигу', async () => {
    const svc = makeService('mock');
    await svc.lookup('7707083893');

    // setNX лок + setEX данных = 2 вызова `set`
    expect(redis.client.set).toHaveBeenCalledWith(
      'inn-lookup:lock:7707083893',
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(redis.client.set).toHaveBeenCalledWith(
      'inn-lookup:mock:7707083893',
      expect.any(String),
      'EX',
      30 * 24 * 60 * 60,
    );
  });

  it('лок снимается даже при ошибке', async () => {
    mockAdapter.lookup.mockRejectedValueOnce(new Error('boom'));
    const svc = makeService('mock');
    await expect(svc.lookup('7707083893')).rejects.toThrow('boom');
    expect(redis.client.del).toHaveBeenCalledWith('inn-lookup:lock:7707083893');
  });

  it('все источники молчат → NotFoundException', async () => {
    mockAdapter.lookup.mockResolvedValueOnce(null);
    const svc = makeService('mock');
    await expect(svc.lookup('9999999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('невалидный ИНН → throw', async () => {
    const svc = makeService('mock');
    await expect(svc.lookup('abc')).rejects.toThrow(/Невалидный ИНН/);
    await expect(svc.lookup('12345')).rejects.toThrow(/Невалидный ИНН/);
  });

  it('invalidate(inn) → keys() + del() возвращает число удалённых', async () => {
    redis.client.keys.mockResolvedValueOnce([
      'inn-lookup:mock:7707083893',
      'inn-lookup:dadata:7707083893',
    ]);
    redis.client.del.mockResolvedValueOnce(2);

    const svc = makeService('mock');
    const deleted = await svc.invalidate('7707083893');

    expect(redis.client.keys).toHaveBeenCalledWith('inn-lookup:*:7707083893');
    expect(redis.client.del).toHaveBeenCalledWith(
      'inn-lookup:mock:7707083893',
      'inn-lookup:dadata:7707083893',
    );
    expect(deleted).toBe(2);
  });

  it('invalidate(inn) без ключей → 0, del не зовётся', async () => {
    redis.client.keys.mockResolvedValueOnce([]);
    const svc = makeService('mock');
    const deleted = await svc.invalidate('7707083893');
    expect(deleted).toBe(0);
    expect(redis.client.del).not.toHaveBeenCalled();
  });
});
