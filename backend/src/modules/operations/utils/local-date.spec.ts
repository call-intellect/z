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
