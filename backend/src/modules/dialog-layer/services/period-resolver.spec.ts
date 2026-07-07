import { describe, expect, it } from 'vitest';

import { detectPeriodExpr, resolvePeriod } from './period-resolver';

const TODAY = '2026-06-10T09:00:00Z';

describe('resolvePeriod (Europe/Moscow, UTC+3)', () => {
  it('this_week → Пн 2026-06-08 .. Вс 2026-06-14 (МСК)', () => {
    const r = resolvePeriod('this_week', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-06-07T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-14T20:59:59.999Z');
  });

  it('yesterday → полный день 2026-06-09 (МСК)', () => {
    const r = resolvePeriod('yesterday', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-06-08T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-09T20:59:59.999Z');
  });

  it('last_month → 2026-05-01 .. 2026-05-31 (МСК)', () => {
    const r = resolvePeriod('last_month', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-04-30T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-05-31T20:59:59.999Z');
  });

  it('last_n_days(7) → 2026-06-04 .. 2026-06-10 (МСК, включая сегодня)', () => {
    const r = resolvePeriod('last_n_days', TODAY, null, 7);
    expect(r.dateFrom?.toISOString()).toBe('2026-06-03T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-10T20:59:59.999Z');
  });

  it('today → полный день 2026-06-10 (МСК)', () => {
    const r = resolvePeriod('today', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-10T20:59:59.999Z');
  });

  it('this_month → 2026-06-01 .. 2026-06-30 (МСК)', () => {
    const r = resolvePeriod('this_month', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-30T20:59:59.999Z');
  });

  it('last_week → Пн 2026-06-01 .. Вс 2026-06-07 (МСК)', () => {
    const r = resolvePeriod('last_week', TODAY);
    expect(r.dateFrom?.toISOString()).toBe('2026-05-31T21:00:00.000Z');
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

  it('невалидная таймзона → дефолт МСК (+3)', () => {
    const r = resolvePeriod('today', TODAY, 'Not/AZone');
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T21:00:00.000Z');
  });

  it('пустая таймзона → дефолт МСК (+3)', () => {
    const r = resolvePeriod('today', TODAY, '');
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T21:00:00.000Z');
  });
});

describe('resolvePeriod (Asia/Yekaterinburg, UTC+5)', () => {
  it('last_month → границы сдвинуты на +300 мин (не +180)', () => {
    const r = resolvePeriod('last_month', TODAY, 'Asia/Yekaterinburg');
    expect(r.dateFrom?.toISOString()).toBe('2026-04-30T19:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-05-31T18:59:59.999Z');
  });

  it('today → полный локальный день при +5', () => {
    const r = resolvePeriod('today', TODAY, 'Asia/Yekaterinburg');
    expect(r.dateFrom?.toISOString()).toBe('2026-06-09T19:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-06-10T18:59:59.999Z');
  });
});

describe('resolvePeriod (Europe/Moscow явно, регресс-guard +180)', () => {
  it('last_month при явном Europe/Moscow → те же границы, что и по дефолту', () => {
    const r = resolvePeriod('last_month', TODAY, 'Europe/Moscow');
    expect(r.dateFrom?.toISOString()).toBe('2026-04-30T21:00:00.000Z');
    expect(r.dateTo?.toISOString()).toBe('2026-05-31T20:59:59.999Z');
  });
});

describe('detectPeriodExpr — детерминированный детектор периода', () => {
  it('«покажи встречи за последнюю неделю» → last_week', () => {
    const r = detectPeriodExpr('покажи встречи за последнюю неделю');
    expect(r.expr).toBe('last_week');
    expect(r.periodDays).toBeNull();
    expect(r.confidence).toBe(0.9);
  });

  it('«за неделю» → last_week', () => {
    expect(detectPeriodExpr('покажи все встречи за неделю').expr).toBe('last_week');
  });

  it('«что было вчера» → yesterday', () => {
    const r = detectPeriodExpr('что было вчера');
    expect(r.expr).toBe('yesterday');
    expect(r.confidence).toBe(0.9);
  });

  it('«созвоны за последние 10 дней» → last_n_days + 10', () => {
    const r = detectPeriodExpr('созвоны за последние 10 дней');
    expect(r.expr).toBe('last_n_days');
    expect(r.periodDays).toBe(10);
  });

  it('«за 7 дней» → last_n_days + 7', () => {
    const r = detectPeriodExpr('что было за 7 дней');
    expect(r.expr).toBe('last_n_days');
    expect(r.periodDays).toBe(7);
  });

  it('«на этой неделе» → this_week', () => {
    expect(detectPeriodExpr('что решали на этой неделе').expr).toBe('this_week');
  });

  it('«за прошлый месяц» → last_month', () => {
    expect(detectPeriodExpr('итоги за прошлый месяц').expr).toBe('last_month');
  });

  it('«за этот месяц» → this_month', () => {
    expect(detectPeriodExpr('что было за этот месяц').expr).toBe('this_month');
  });

  it('«сегодня» → today', () => {
    expect(detectPeriodExpr('что запланировано на сегодня').expr).toBe('today');
  });

  it('«что по продажам» → none, confidence 0', () => {
    const r = detectPeriodExpr('что по продажам');
    expect(r.expr).toBe('none');
    expect(r.periodDays).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('нестроковый вход → none', () => {
    expect(detectPeriodExpr(undefined as never).expr).toBe('none');
  });
});
