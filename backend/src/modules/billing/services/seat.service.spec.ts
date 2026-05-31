/**
 * Unit-тесты SeatService — формулы цены и pro-rata.
 *
 * Покрытие:
 *   - calculateMonthlyPriceKopecks: 60k, 60k+1k×extra (code-fallback)
 *   - calculateYearlyPriceKopecks: monthly × 12 × 0.80 (code-fallback)
 *   - calculatePricing: monthly / yearly с правильным разбиением
 *   - calculateAddSeatsMonthlyProrata: 0/частичный/полный месяц, cap по 30 дней
 *   - calculateAddSeatsYearlyProrata: 0/частичный/12 мес, со скидкой 20%
 *   - calculateMeetingsGrant: делегирование в MeetingsBalanceService
 *   - ensureNonNegativeInt: throw на отрицательных/нецелых
 *   - AdminSetting override: getDynamic возвращает не-default → расчёт по
 *     новой цене (имитация правки прайса super_admin)
 *
 * Все методы async — каждый тест использует await. `TypedConfigService` мокается
 * `getDynamic = (k, _e, def) => def` (= возвращает code-fallback), что
 * эмулирует «AdminSettingsService недоступен / ключа нет в БД».
 */

import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { MeetingsBalanceService } from '../../meetings-balance/meetings-balance.service';

import { SeatService } from './seat.service';

/**
 * Мок `TypedConfigService.getDynamic`, который возвращает `defaultValue`
 * (= code-fallback). Эмулирует ситуацию «ключа нет в AdminSetting» или
 * «AdminSettingsService недоступен».
 */
function makeFallbackCfg(): TypedConfigService {
  return {
    getDynamic: async <T>(
      _key: string,
      _envKey: string | undefined,
      def: T,
    ): Promise<T> => def,
  } as unknown as TypedConfigService;
}

/**
 * Мок `MeetingsBalanceService.calculateMeetingsGrant` с фиксированными
 * code-fallback значениями (150 + extra × 5). Возвращается типобезопасно,
 * только нужные SeatService методы.
 */
function makeMeetingsBalanceMock(): MeetingsBalanceService {
  return {
    calculateMeetingsGrant: async (extra: number) =>
      150 + Math.max(0, extra) * 5,
  } as unknown as MeetingsBalanceService;
}

function makeSeatService(): SeatService {
  return new SeatService(makeFallbackCfg(), makeMeetingsBalanceMock());
}

describe('SeatService.calculateMonthlyPriceKopecks (code-fallback)', () => {
  const svc = makeSeatService();

  it('seatsExtra=0 → 60 000 ₽ = 6 000 000 копеек', async () => {
    expect(await svc.calculateMonthlyPriceKopecks(0)).toBe(6_000_000);
  });

  it('seatsExtra=1 → 61 000 ₽ = 6 100 000 копеек', async () => {
    expect(await svc.calculateMonthlyPriceKopecks(1)).toBe(6_100_000);
  });

  it('seatsExtra=10 → 70 000 ₽ = 7 000 000 копеек', async () => {
    expect(await svc.calculateMonthlyPriceKopecks(10)).toBe(7_000_000);
  });

  it('seatsExtra=100 → 160 000 ₽ = 16 000 000 копеек', async () => {
    expect(await svc.calculateMonthlyPriceKopecks(100)).toBe(16_000_000);
  });

  it('отрицательный seatsExtra → throw', async () => {
    await expect(svc.calculateMonthlyPriceKopecks(-1)).rejects.toThrow(
      /seatsExtra/,
    );
  });

  it('нецелый seatsExtra → throw', async () => {
    await expect(svc.calculateMonthlyPriceKopecks(1.5)).rejects.toThrow(
      /seatsExtra/,
    );
  });
});

describe('SeatService.calculateYearlyPriceKopecks (code-fallback)', () => {
  const svc = makeSeatService();

  it('seatsExtra=0 → 60 000 × 12 × 0.80 = 576 000 ₽ = 57 600 000 копеек', async () => {
    expect(await svc.calculateYearlyPriceKopecks(0)).toBe(57_600_000);
  });

  it('seatsExtra=1 → 61 000 × 12 × 0.80 = 585 600 ₽', async () => {
    expect(await svc.calculateYearlyPriceKopecks(1)).toBe(58_560_000);
  });

  it('seatsExtra=5 → 65 000 × 12 × 0.80 = 624 000 ₽', async () => {
    expect(await svc.calculateYearlyPriceKopecks(5)).toBe(62_400_000);
  });
});

describe('SeatService.calculatePricing (code-fallback)', () => {
  const svc = makeSeatService();

  it('monthly: monthlyKopecks = periodKopecks, discount=0', async () => {
    const p = await svc.calculatePricing('monthly', 0);
    expect(p.monthlyKopecks).toBe(6_000_000);
    expect(p.periodKopecks).toBe(6_000_000);
    expect(p.discountKopecks).toBe(0);
    expect(p.monthsInPeriod).toBe(1);
    expect(p.baseMonthlyKopecks).toBe(6_000_000);
    expect(p.seatsExtraKopecks).toBe(0);
  });

  it('yearly seatsExtra=0: gross=72M, period=57.6M, discount=14.4M', async () => {
    const p = await svc.calculatePricing('yearly', 0);
    expect(p.monthlyKopecks).toBe(6_000_000);
    expect(p.monthsInPeriod).toBe(12);
    expect(p.periodKopecks).toBe(57_600_000);
    expect(p.discountKopecks).toBe(72_000_000 - 57_600_000);
    expect(p.discountKopecks).toBe(14_400_000);
  });

  it('yearly seatsExtra=10: monthly=70k, period=672k, discount=168k', async () => {
    const p = await svc.calculatePricing('yearly', 10);
    expect(p.monthlyKopecks).toBe(7_000_000);
    expect(p.periodKopecks).toBe(67_200_000); // 70k × 12 × 0.8 = 672 000
    expect(p.discountKopecks).toBe(7_000_000 * 12 - 67_200_000);
    expect(p.seatsExtraKopecks).toBe(10 * 100_000);
  });
});

describe('SeatService.calculateAddSeatsMonthlyProrata (code-fallback)', () => {
  const svc = makeSeatService();
  const PRORATA_DAYS_IN_MONTH = 30; // зеркало бизнес-формата биллинга

  it('seatsToAdd=0 → 0', async () => {
    expect(
      await svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 0,
        daysLeftInPeriod: 15,
      }),
    ).toBe(0);
  });

  it('daysLeftInPeriod=0 → 0', async () => {
    expect(
      await svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 5,
        daysLeftInPeriod: 0,
      }),
    ).toBe(0);
  });

  it('5 мест × 30 дней (полный месяц) = 5 × 1 000 ₽ = 5 000 ₽', async () => {
    expect(
      await svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 5,
        daysLeftInPeriod: 30,
      }),
    ).toBe(500_000);
  });

  it('5 мест × 15 дней (половина месяца) = 5 × 1 000 × 15/30 = 2 500 ₽', async () => {
    expect(
      await svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 5,
        daysLeftInPeriod: 15,
      }),
    ).toBe(250_000);
  });

  it('cap по PRORATA_DAYS_IN_MONTH: 5 мест × 45 дней ≈ как 30 дней', async () => {
    const cap = await svc.calculateAddSeatsMonthlyProrata({
      seatsToAdd: 5,
      daysLeftInPeriod: PRORATA_DAYS_IN_MONTH,
    });
    const over = await svc.calculateAddSeatsMonthlyProrata({
      seatsToAdd: 5,
      daysLeftInPeriod: 45,
    });
    expect(over).toBe(cap);
  });
});

describe('SeatService.calculateAddSeatsYearlyProrata (code-fallback)', () => {
  const svc = makeSeatService();

  it('seatsToAdd=0 → 0', async () => {
    expect(
      await svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 0,
        monthsLeftInPeriod: 6,
      }),
    ).toBe(0);
  });

  it('monthsLeftInPeriod=0 → 0', async () => {
    expect(
      await svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 0,
      }),
    ).toBe(0);
  });

  it('5 мест × 12 мес × 0.8 = 5 × 1 000 × 12 × 0.8 = 48 000 ₽', async () => {
    expect(
      await svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 12,
      }),
    ).toBe(4_800_000);
  });

  it('5 мест × 6 мес × 0.8 = 24 000 ₽', async () => {
    expect(
      await svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 6,
      }),
    ).toBe(2_400_000);
  });

  it('cap по 12 месяцев', async () => {
    const cap = await svc.calculateAddSeatsYearlyProrata({
      seatsToAdd: 5,
      monthsLeftInPeriod: 12,
    });
    const over = await svc.calculateAddSeatsYearlyProrata({
      seatsToAdd: 5,
      monthsLeftInPeriod: 18,
    });
    expect(over).toBe(cap);
  });
});

describe('SeatService.calculateMeetingsGrant — делегирование в MeetingsBalanceService', () => {
  const svc = makeSeatService();
  it('передаёт seatsExtra и возвращает результат балансера (150 + extra × 5)', async () => {
    expect(await svc.calculateMeetingsGrant(0)).toBe(150);
    expect(await svc.calculateMeetingsGrant(10)).toBe(200);
    expect(await svc.calculateMeetingsGrant(100)).toBe(650);
  });
});

describe('SeatService — AdminSetting override', () => {
  /**
   * Эмулируем правку super_admin: `billing.baseMonthlyKopecks` = 7 000 000
   * (70 000 ₽). `perExtraSeatKopecks` и `yearlyDiscountRate` — на дефолтах.
   * Ожидание: новая базовая цена попадает в расчёт сразу.
   */
  function makeOverridingCfg(overrides: Record<string, number>): TypedConfigService {
    return {
      getDynamic: async <T>(
        key: string,
        _envKey: string | undefined,
        def: T,
      ): Promise<T> => {
        if (key in overrides) return overrides[key] as unknown as T;
        return def;
      },
    } as unknown as TypedConfigService;
  }

  it('calculateMonthlyPriceKopecks: использует AdminSetting если задан', async () => {
    const cfg = makeOverridingCfg({ 'billing.baseMonthlyKopecks': 7_000_000 });
    const svc = new SeatService(cfg, makeMeetingsBalanceMock());
    expect(await svc.calculateMonthlyPriceKopecks(0)).toBe(7_000_000);
    expect(await svc.calculateMonthlyPriceKopecks(5)).toBe(7_500_000); // +5 × 1000 ₽
  });

  it('calculateYearlyPriceKopecks: учитывает override yearlyDiscountRate', async () => {
    // 70% скидка вместо 80% (= 30% off) на базовом тарифе:
    // 6 000 000 × 12 × 0.7 = 50 400 000
    const cfg = makeOverridingCfg({ 'billing.yearlyDiscountRate': 0.7 });
    const svc = new SeatService(cfg, makeMeetingsBalanceMock());
    expect(await svc.calculateYearlyPriceKopecks(0)).toBe(50_400_000);
  });

  it('calculatePricing yearly: baseMonthlyKopecks отражает override', async () => {
    const cfg = makeOverridingCfg({
      'billing.baseMonthlyKopecks': 7_000_000,
      'billing.perExtraSeatKopecks': 150_000, // 1 500 ₽/место
    });
    const svc = new SeatService(cfg, makeMeetingsBalanceMock());
    const p = await svc.calculatePricing('yearly', 4);
    // monthly = 7M + 4 × 150k = 7 600 000 ₽-копеек
    expect(p.monthlyKopecks).toBe(7_600_000);
    expect(p.baseMonthlyKopecks).toBe(7_000_000);
    expect(p.seatsExtraKopecks).toBe(600_000);
    // yearly = round(7 600 000 × 12 × 0.8) = 72 960 000
    expect(p.periodKopecks).toBe(72_960_000);
  });
});
