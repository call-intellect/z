/**
 * Unit-тесты SeatService — формулы цены и pro-rata.
 *
 * Покрытие:
 *   - calculateMonthlyPriceKopecks: 60k, 60k+1k×extra
 *   - calculateYearlyPriceKopecks: monthly × 12 × 0.80
 *   - calculatePricing: monthly / yearly с правильным разбиением
 *   - calculateAddSeatsMonthlyProrata: 0/частичный/полный месяц, cap по 30 дней
 *   - calculateAddSeatsYearlyProrata: 0/частичный/12 мес, со скидкой 20%
 *   - calculateMeetingsGrant: 150 + 5×extra
 *   - ensureNonNegativeInt: throw на отрицательных/нецелых
 */

import { describe, expect, it } from 'vitest';

import {
  BASE_MONTHLY_PRICE_KOPECKS,
  PER_EXTRA_SEAT_KOPECKS,
  PRORATA_DAYS_IN_MONTH,
  SeatService,
  YEARLY_DISCOUNT_RATE,
  YEARLY_MONTHS,
} from './seat.service';

describe('SeatService.calculateMonthlyPriceKopecks', () => {
  const svc = new SeatService();

  it('seatsExtra=0 → 60 000 ₽ = 6 000 000 копеек', () => {
    expect(svc.calculateMonthlyPriceKopecks(0)).toBe(6_000_000);
    expect(svc.calculateMonthlyPriceKopecks(0)).toBe(BASE_MONTHLY_PRICE_KOPECKS);
  });

  it('seatsExtra=1 → 61 000 ₽ = 6 100 000 копеек', () => {
    expect(svc.calculateMonthlyPriceKopecks(1)).toBe(6_100_000);
  });

  it('seatsExtra=10 → 70 000 ₽ = 7 000 000 копеек', () => {
    expect(svc.calculateMonthlyPriceKopecks(10)).toBe(7_000_000);
  });

  it('seatsExtra=100 → 160 000 ₽ = 16 000 000 копеек', () => {
    expect(svc.calculateMonthlyPriceKopecks(100)).toBe(16_000_000);
  });

  it('отрицательный seatsExtra → throw', () => {
    expect(() => svc.calculateMonthlyPriceKopecks(-1)).toThrow(/seatsExtra/);
  });

  it('нецелый seatsExtra → throw', () => {
    expect(() => svc.calculateMonthlyPriceKopecks(1.5)).toThrow(/seatsExtra/);
  });
});

describe('SeatService.calculateYearlyPriceKopecks', () => {
  const svc = new SeatService();

  it('seatsExtra=0 → 60 000 × 12 × 0.80 = 576 000 ₽ = 57 600 000 копеек', () => {
    const expected = Math.round(
      BASE_MONTHLY_PRICE_KOPECKS * YEARLY_MONTHS * YEARLY_DISCOUNT_RATE,
    );
    expect(svc.calculateYearlyPriceKopecks(0)).toBe(57_600_000);
    expect(svc.calculateYearlyPriceKopecks(0)).toBe(expected);
  });

  it('seatsExtra=1 → 61 000 × 12 × 0.80 = 585 600 ₽', () => {
    expect(svc.calculateYearlyPriceKopecks(1)).toBe(58_560_000);
  });

  it('seatsExtra=5 → 65 000 × 12 × 0.80 = 624 000 ₽', () => {
    expect(svc.calculateYearlyPriceKopecks(5)).toBe(62_400_000);
  });
});

describe('SeatService.calculatePricing', () => {
  const svc = new SeatService();

  it('monthly: monthlyKopecks = periodKopecks, discount=0', () => {
    const p = svc.calculatePricing('monthly', 0);
    expect(p.monthlyKopecks).toBe(6_000_000);
    expect(p.periodKopecks).toBe(6_000_000);
    expect(p.discountKopecks).toBe(0);
    expect(p.monthsInPeriod).toBe(1);
    expect(p.baseMonthlyKopecks).toBe(BASE_MONTHLY_PRICE_KOPECKS);
    expect(p.seatsExtraKopecks).toBe(0);
  });

  it('yearly seatsExtra=0: gross=72M, period=57.6M, discount=14.4M', () => {
    const p = svc.calculatePricing('yearly', 0);
    expect(p.monthlyKopecks).toBe(6_000_000);
    expect(p.monthsInPeriod).toBe(12);
    expect(p.periodKopecks).toBe(57_600_000);
    expect(p.discountKopecks).toBe(72_000_000 - 57_600_000);
    expect(p.discountKopecks).toBe(14_400_000);
  });

  it('yearly seatsExtra=10: monthly=70k, period=672k, discount=168k', () => {
    const p = svc.calculatePricing('yearly', 10);
    expect(p.monthlyKopecks).toBe(7_000_000);
    expect(p.periodKopecks).toBe(67_200_000); // 70k × 12 × 0.8 = 672 000
    expect(p.discountKopecks).toBe(7_000_000 * 12 - 67_200_000);
    expect(p.seatsExtraKopecks).toBe(10 * PER_EXTRA_SEAT_KOPECKS);
  });
});

describe('SeatService.calculateAddSeatsMonthlyProrata', () => {
  const svc = new SeatService();

  it('seatsToAdd=0 → 0', () => {
    expect(
      svc.calculateAddSeatsMonthlyProrata({ seatsToAdd: 0, daysLeftInPeriod: 15 }),
    ).toBe(0);
  });

  it('daysLeftInPeriod=0 → 0', () => {
    expect(
      svc.calculateAddSeatsMonthlyProrata({ seatsToAdd: 5, daysLeftInPeriod: 0 }),
    ).toBe(0);
  });

  it('5 мест × 30 дней (полный месяц) = 5 × 1 000 ₽ = 5 000 ₽', () => {
    expect(
      svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 5,
        daysLeftInPeriod: 30,
      }),
    ).toBe(500_000);
  });

  it('5 мест × 15 дней (половина месяца) = 5 × 1 000 × 15/30 = 2 500 ₽', () => {
    expect(
      svc.calculateAddSeatsMonthlyProrata({
        seatsToAdd: 5,
        daysLeftInPeriod: 15,
      }),
    ).toBe(250_000);
  });

  it('cap по PRORATA_DAYS_IN_MONTH: 5 мест × 45 дней ≈ как 30 дней', () => {
    const cap = svc.calculateAddSeatsMonthlyProrata({
      seatsToAdd: 5,
      daysLeftInPeriod: PRORATA_DAYS_IN_MONTH,
    });
    const over = svc.calculateAddSeatsMonthlyProrata({
      seatsToAdd: 5,
      daysLeftInPeriod: 45,
    });
    expect(over).toBe(cap);
  });
});

describe('SeatService.calculateAddSeatsYearlyProrata', () => {
  const svc = new SeatService();

  it('seatsToAdd=0 → 0', () => {
    expect(
      svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 0,
        monthsLeftInPeriod: 6,
      }),
    ).toBe(0);
  });

  it('monthsLeftInPeriod=0 → 0', () => {
    expect(
      svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 0,
      }),
    ).toBe(0);
  });

  it('5 мест × 12 мес × 0.8 = 5 × 1 000 × 12 × 0.8 = 48 000 ₽', () => {
    expect(
      svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 12,
      }),
    ).toBe(4_800_000);
  });

  it('5 мест × 6 мес × 0.8 = 24 000 ₽', () => {
    expect(
      svc.calculateAddSeatsYearlyProrata({
        seatsToAdd: 5,
        monthsLeftInPeriod: 6,
      }),
    ).toBe(2_400_000);
  });

  it('cap по 12 месяцев', () => {
    const cap = svc.calculateAddSeatsYearlyProrata({
      seatsToAdd: 5,
      monthsLeftInPeriod: 12,
    });
    const over = svc.calculateAddSeatsYearlyProrata({
      seatsToAdd: 5,
      monthsLeftInPeriod: 18,
    });
    expect(over).toBe(cap);
  });
});

describe('SeatService.calculateMeetingsGrant', () => {
  const svc = new SeatService();
  it('150 + 5×extra', () => {
    expect(svc.calculateMeetingsGrant(0)).toBe(150);
    expect(svc.calculateMeetingsGrant(10)).toBe(200);
    expect(svc.baseMeetingsGrant).toBe(150);
    expect(svc.perExtraSeatMeetingsGrant).toBe(5);
  });
});
