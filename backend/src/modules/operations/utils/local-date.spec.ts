/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Фаза 2 — unit-тесты хелперов
 * «дня недели / времени / строки Сейчас…» для контекста AI-помощника.
 *
 * Цель: дать LLM детерминированную точку отсчёта («сегодня/завтра/в среду»).
 * Все функции чистые (now передаётся аргументом) → ассерты детерминированы.
 *
 * Фактические русские дни недели для дат прогнаны через Intl (не угаданы):
 *   2026-06-18T09:30:00Z → четверг (и в Asia/Novosibirsk, и в Europe/Moscow).
 *   2026-06-17T20:00:00Z в Asia/Novosibirsk → уже 2026-06-18, четверг.
 */
import { describe, expect, it } from 'vitest';

import {
  buildNowContextLine,
  getLocalTime,
  getLocalWeekday,
  localDayBoundsUtc,
  localDayWindowUtc,
  startOfLocalDayUtc,
} from './local-date';

// Фиксированный момент: 18 июня 2026, 09:30 UTC.
const NOW = new Date('2026-06-18T09:30:00.000Z');

describe('getLocalTime — локальное HH:mm для TZ', () => {
  it('Asia/Novosibirsk (UTC+7) → 16:30', () => {
    expect(getLocalTime(NOW, 'Asia/Novosibirsk')).toBe('16:30');
  });

  it('Europe/Moscow (UTC+3) → 12:30', () => {
    expect(getLocalTime(NOW, 'Europe/Moscow')).toBe('12:30');
  });

  it('null → дефолт Moscow → 12:30', () => {
    expect(getLocalTime(NOW, null)).toBe('12:30');
  });
});

describe('getLocalWeekday — русский день недели для TZ', () => {
  it('Asia/Novosibirsk → четверг', () => {
    expect(getLocalWeekday(NOW, 'Asia/Novosibirsk')).toBe('четверг');
  });

  it('Europe/Moscow → четверг', () => {
    expect(getLocalWeekday(NOW, 'Europe/Moscow')).toBe('четверг');
  });

  it('null → дефолт Moscow → четверг', () => {
    expect(getLocalWeekday(NOW, null)).toBe('четверг');
  });
});

describe('buildNowContextLine — строка «Сейчас…» для USER-блока', () => {
  it('Asia/Novosibirsk: содержит дату, время и TZ', () => {
    const line = buildNowContextLine(NOW, 'Asia/Novosibirsk');
    expect(line).toContain('Сейчас: 2026-06-18');
    expect(line).toContain('четверг');
    expect(line).toContain('16:30');
    expect(line).toContain('(Asia/Novosibirsk)');
  });

  it('Europe/Moscow: время 12:30 и TZ Moscow', () => {
    const line = buildNowContextLine(NOW, 'Europe/Moscow');
    expect(line).toContain('Сейчас: 2026-06-18');
    expect(line).toContain('12:30');
    expect(line).toContain('(Europe/Moscow)');
  });

  it('null → дефолт Moscow (12:30, Europe/Moscow)', () => {
    const line = buildNowContextLine(NOW, null);
    expect(line).toContain('12:30');
    expect(line).toContain('(Europe/Moscow)');
  });
});

describe('граница суток — TZ переносит дату на следующий день', () => {
  // 17 июня 20:00 UTC = 18 июня 03:00 в Новосибирске (UTC+7).
  const LATE = new Date('2026-06-17T20:00:00.000Z');

  it('Asia/Novosibirsk: локально уже 2026-06-18, 03:00', () => {
    expect(getLocalTime(LATE, 'Asia/Novosibirsk')).toBe('03:00');
    const line = buildNowContextLine(LATE, 'Asia/Novosibirsk');
    expect(line).toContain('Сейчас: 2026-06-18');
    expect(line).toContain('03:00');
    expect(line).toContain('четверг');
  });
});

/**
 * Ф3 (ТЗ assistant-calendar-master) — окно «локальных суток» в UTC.
 * Эталонные UTC-моменты прогнаны через Intl (en-CA), НЕ угаданы:
 *   2026-06-18T09:30Z (лок. 16:30 чт в Asia/Novosibirsk, UTC+7)
 *     → 00:00 18-го новосиб. = 2026-06-17T17:00:00Z;
 *   то же в Europe/Moscow (лок. 12:30) → 2026-06-17T21:00:00Z;
 *   граница: 2026-06-17T20:00Z (лок. 03:00 18-го новосиб.)
 *     → start 2026-06-17T17:00:00Z, to 2026-06-18T17:00:00Z.
 */
describe('startOfLocalDayUtc — 00:00 локального дня в UTC', () => {
  const NOON = new Date('2026-06-18T09:30:00.000Z');

  it('Asia/Novosibirsk (UTC+7) → 2026-06-17T17:00:00Z', () => {
    expect(startOfLocalDayUtc(NOON, 'Asia/Novosibirsk').toISOString()).toBe(
      '2026-06-17T17:00:00.000Z',
    );
  });

  it('Europe/Moscow (UTC+3) → 2026-06-17T21:00:00Z', () => {
    expect(startOfLocalDayUtc(NOON, 'Europe/Moscow').toISOString()).toBe(
      '2026-06-17T21:00:00.000Z',
    );
  });

  it('null → дефолт Moscow → 2026-06-17T21:00:00Z', () => {
    expect(startOfLocalDayUtc(NOON, null).toISOString()).toBe(
      '2026-06-17T21:00:00.000Z',
    );
  });
});

describe('localDayWindowUtc — окно [00:00, +24ч) локального дня', () => {
  it('Asia/Novosibirsk на 2026-06-18T09:30Z → [17:00 17-го, 17:00 18-го)', () => {
    const w = localDayWindowUtc(
      new Date('2026-06-18T09:30:00.000Z'),
      'Asia/Novosibirsk',
    );
    expect(w.from.toISOString()).toBe('2026-06-17T17:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-06-18T17:00:00.000Z');
  });

  it('граница суток: 2026-06-17T20:00Z (лок. 03:00 18-го) → то же окно', () => {
    const w = localDayWindowUtc(
      new Date('2026-06-17T20:00:00.000Z'),
      'Asia/Novosibirsk',
    );
    expect(w.from.toISOString()).toBe('2026-06-17T17:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-06-18T17:00:00.000Z');
  });
});

describe('localDayBoundsUtc — dayOfWeek (0=вс..6=сб)', () => {
  it('2026-06-18T09:30Z в Asia/Novosibirsk → четверг (dow=4)', () => {
    // Прогон через Intl: четверг = 4.
    expect(
      localDayBoundsUtc(new Date('2026-06-18T09:30:00.000Z'), 'Asia/Novosibirsk')
        .dayOfWeek,
    ).toBe(4);
  });

  it('2026-06-17T20:00Z в Europe/Moscow (лок. 23:00 17-го) → среда (dow=3)', () => {
    // Прогон через Intl: 17-е июня 2026 = среда = 3.
    const b = localDayBoundsUtc(
      new Date('2026-06-17T20:00:00.000Z'),
      'Europe/Moscow',
    );
    expect(b.dayOfWeek).toBe(3);
    expect(b.startOfDayUtc.toISOString()).toBe('2026-06-16T21:00:00.000Z');
  });

  it('невалидная TZ → fallback UTC (startOfDay через setUTCHours)', () => {
    const b = localDayBoundsUtc(new Date('2026-06-18T09:30:00.000Z'), 'Not/AZone');
    expect(b.startOfDayUtc.toISOString()).toBe('2026-06-18T00:00:00.000Z');
  });
});
