import { describe, expect, it } from 'vitest';

import { resolvePeriod } from './period-resolver';

/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — спецификация
 * детерминированного резолвера периода. Все ожидаемые значения посчитаны
 * вручную в МСК (UTC+3): локальная полночь → UTC = − 3 часа.
 *
 * Якорь «сегодня» во всех кейсах: 2026-06-10T09:00:00Z = 2026-06-10 12:00 МСК
 * (среда). Неделя Пн..Вс: 2026-06-08 (Пн) .. 2026-06-14 (Вс).
 */
const TODAY = '2026-06-10T09:00:00Z';

describe('resolvePeriod (Europe/Moscow, UTC+3)', () => {
  it('this_week → Пн 2026-06-08 .. Вс 2026-06-14 (МСК)', () => {
    const r = resolvePeriod('this_week', TODAY);
    // 2026-06-08T00:00 МСК = 2026-06-07T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-06-07T21:00:00.000Z');
    // 2026-06-14T23:59:59.999 МСК = 2026-06-14T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-06-14T20:59:59.999Z');
  });

  it('yesterday → полный день 2026-06-09 (МСК)', () => {
    const r = resolvePeriod('yesterday', TODAY);
    // 2026-06-09T00:00 МСК = 2026-06-08T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-06-08T21:00:00.000Z');
    // 2026-06-09T23:59:59.999 МСК = 2026-06-09T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-06-09T20:59:59.999Z');
  });

  it('last_month → 2026-05-01 .. 2026-05-31 (МСК)', () => {
    const r = resolvePeriod('last_month', TODAY);
    // 2026-05-01T00:00 МСК = 2026-04-30T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-04-30T21:00:00.000Z');
    // 2026-05-31T23:59:59.999 МСК = 2026-05-31T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-05-31T20:59:59.999Z');
  });

  it('last_n_days(7) → 2026-06-04 .. 2026-06-10 (МСК, включая сегодня)', () => {
    const r = resolvePeriod('last_n_days', TODAY, null, 7);
    // 2026-06-04T00:00 МСК = 2026-06-03T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-06-03T21:00:00.000Z');
    // 2026-06-10T23:59:59.999 МСК = 2026-06-10T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-06-10T20:59:59.999Z');
  });

  it('today → полный день 2026-06-10 (МСК)', () => {
    const r = resolvePeriod('today', TODAY);
    // 2026-06-10T00:00 МСК = 2026-06-09T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-10T20:59:59.999Z');
  });

  it('this_month → 2026-06-01 .. 2026-06-30 (МСК)', () => {
    const r = resolvePeriod('this_month', TODAY);
    // 2026-06-01T00:00 МСК = 2026-05-31T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    // 2026-06-30T23:59:59.999 МСК = 2026-06-30T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-06-30T20:59:59.999Z');
  });

  it('last_week → Пн 2026-06-01 .. Вс 2026-06-07 (МСК)', () => {
    const r = resolvePeriod('last_week', TODAY);
    // 2026-06-01T00:00 МСК = 2026-05-31T21:00:00.000Z
    expect(r.dateFrom?.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    // 2026-06-07T23:59:59.999 МСК = 2026-06-07T20:59:59.999Z
    expect(r.dateTo?.toISOString()).toBe('2026-06-07T20:59:59.999Z');
  });

  it('none → оба null', () => {
    const r = resolvePeriod('none', TODAY);
    expect(r.dateFrom).toBeNull();
    expect(r.dateTo).toBeNull();
  });

  it('last_n_days с periodDays=null → оба null', () => {
    const r = resolvePeriod('last_n_days', TODAY, null, null);
    expect(r.dateFrom).toBeNull();
    expect(r.dateTo).toBeNull();
  });

  it('last_n_days с periodDays<=0 → оба null', () => {
    const r = resolvePeriod('last_n_days', TODAY, null, 0);
    expect(r.dateFrom).toBeNull();
    expect(r.dateTo).toBeNull();
  });

  it('неизвестная таймзона → дефолт МСК (+3)', () => {
    const r = resolvePeriod('today', TODAY, 'Asia/Tokyo');
    // всё равно считаем по МСК
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T21:00:00.000Z');
  });
});
