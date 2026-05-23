import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CurrencyRateSyncCron } from './currency-rate-sync.cron';

/**
 * SBA α-10 wave 3 — тесты sync курса USD/RUB от ЦБ РФ + fallback.
 */
describe('CurrencyRateSyncCron', () => {
  const fakePrisma = {
    currencyRate: { upsert: vi.fn(async () => ({})) },
  } as unknown as ConstructorParameters<typeof CurrencyRateSyncCron>[0];
  const fakeCfg = {
    budget: {
      currencyRateApiUrl: 'https://example/api',
      currencyFallbackUsdRub: 90,
    },
  } as unknown as ConstructorParameters<typeof CurrencyRateSyncCron>[1];
  const fakeFx = { invalidate: vi.fn() } as unknown as ConstructorParameters<
    typeof CurrencyRateSyncCron
  >[2];
  const metrics = {
    incCurrencyRateSync: vi.fn(),
    setCurrencyRateUsdRub: vi.fn(),
  } as unknown as ConstructorParameters<typeof CurrencyRateSyncCron>[3];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('парсит валидный ответ ЦБ РФ', async () => {
    const cron = new CurrencyRateSyncCron(fakePrisma, fakeCfg, fakeFx, metrics);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          Date: '2026-05-23T00:00:00+03:00',
          Valute: { USD: { Value: 92.5 } },
        }),
      })),
    );
    const r = await cron.runOnce();
    expect(r.rate).toBe(92.5);
    expect(r.source).toBe('cbr');
    expect(metrics.incCurrencyRateSync).toHaveBeenCalledWith('success');
    expect(metrics.setCurrencyRateUsdRub).toHaveBeenCalledWith(92.5);
  });

  it('fallback при ошибке API', async () => {
    const cron = new CurrencyRateSyncCron(fakePrisma, fakeCfg, fakeFx, metrics);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND example');
      }),
    );
    const r = await cron.runOnce();
    expect(r.source).toBe('fallback');
    expect(r.rate).toBe(90);
    expect(metrics.incCurrencyRateSync).toHaveBeenCalledWith('failed');
  });

  it('fallback при HTTP 5xx', async () => {
    const cron = new CurrencyRateSyncCron(fakePrisma, fakeCfg, fakeFx, metrics);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const r = await cron.runOnce();
    expect(r.source).toBe('fallback');
    expect(metrics.incCurrencyRateSync).toHaveBeenCalledWith('failed');
  });
});
