import { describe, expect, it } from 'vitest';

import { parseRussianDueDate } from './parse-russian-due-date';

const NOW = new Date('2026-06-22T10:00:00Z');

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

describe('parseRussianDueDate', () => {
  it('ISO YYYY-MM-DD', () => {
    expect(iso(parseRussianDueDate('2026-07-01', NOW))).toBe('2026-07-01T00:00:00.000Z');
  });

  it('DD.MM.YYYY', () => {
    expect(iso(parseRussianDueDate('01.07.2026', NOW))).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(parseRussianDueDate('5.3.2027', NOW))).toBe('2027-03-05T00:00:00.000Z');
  });

  it('DD.MM — текущий год, прошедшую дату переносит на след. год', () => {
    expect(iso(parseRussianDueDate('01.07', NOW))).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(parseRussianDueDate('01.01', NOW))).toBe('2027-01-01T00:00:00.000Z');
  });

  it('сегодня / завтра / послезавтра', () => {
    expect(iso(parseRussianDueDate('сегодня', NOW))).toBe('2026-06-22T00:00:00.000Z');
    expect(iso(parseRussianDueDate('завтра', NOW))).toBe('2026-06-23T00:00:00.000Z');
    expect(iso(parseRussianDueDate('послезавтра', NOW))).toBe('2026-06-24T00:00:00.000Z');
  });

  it('дни недели — ближайший будущий', () => {
    expect(iso(parseRussianDueDate('в пятницу', NOW))).toBe('2026-06-26T00:00:00.000Z');
    expect(iso(parseRussianDueDate('до пятницы', NOW))).toBe('2026-06-26T00:00:00.000Z');
    expect(iso(parseRussianDueDate('к среде', NOW))).toBe('2026-06-24T00:00:00.000Z');
    expect(iso(parseRussianDueDate('во вторник', NOW))).toBe('2026-06-23T00:00:00.000Z');
  });

  it('тот же день недели что сегодня (понедельник) → следующая неделя', () => {
    expect(iso(parseRussianDueDate('в понедельник', NOW))).toBe('2026-06-29T00:00:00.000Z');
  });

  it('воскресенье', () => {
    expect(iso(parseRussianDueDate('к воскресенью', NOW))).toBe('2026-06-28T00:00:00.000Z');
  });

  it('через N дней / недель / неделю / месяц', () => {
    expect(iso(parseRussianDueDate('через 3 дня', NOW))).toBe('2026-06-25T00:00:00.000Z');
    expect(iso(parseRussianDueDate('через 1 день', NOW))).toBe('2026-06-23T00:00:00.000Z');
    expect(iso(parseRussianDueDate('через 10 дней', NOW))).toBe('2026-07-02T00:00:00.000Z');
    expect(iso(parseRussianDueDate('через 2 недели', NOW))).toBe('2026-07-06T00:00:00.000Z');
    expect(iso(parseRussianDueDate('через неделю', NOW))).toBe('2026-06-29T00:00:00.000Z');
    expect(iso(parseRussianDueDate('через месяц', NOW))).toBe('2026-07-22T00:00:00.000Z');
  });

  it('N <месяц> в любом склонении', () => {
    expect(iso(parseRussianDueDate('25 июня', NOW))).toBe('2026-06-25T00:00:00.000Z');
    expect(iso(parseRussianDueDate('3 марта', NOW))).toBe('2027-03-03T00:00:00.000Z');
    expect(iso(parseRussianDueDate('1 сентября', NOW))).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(parseRussianDueDate('15 мая', NOW))).toBe('2027-05-15T00:00:00.000Z');
    expect(iso(parseRussianDueDate('10 май', NOW))).toBe('2027-05-10T00:00:00.000Z');
  });

  it('нормализация: ё→е, регистр, пробелы', () => {
    expect(iso(parseRussianDueDate('  ПОСЛЕЗАВТРА  ', NOW))).toBe('2026-06-24T00:00:00.000Z');
    expect(iso(parseRussianDueDate('5 февраля', NOW))).toBe('2027-02-05T00:00:00.000Z');
  });

  it('в свободном тексте находит срок', () => {
    expect(iso(parseRussianDueDate('давай к среде успеем', NOW))).toBe('2026-06-24T00:00:00.000Z');
    expect(iso(parseRussianDueDate('нужно сделать до 30.06', NOW))).toBe(
      '2026-06-30T00:00:00.000Z',
    );
  });

  it('якорит относительный срок к переданной дате-источнику, а не к «сегодня»', () => {
    const PAST_ANCHOR = new Date('2024-01-01T00:00:00Z');
    expect(iso(parseRussianDueDate('во вторник', PAST_ANCHOR))).toBe(
      '2024-01-02T00:00:00.000Z',
    );
    expect(iso(parseRussianDueDate('через неделю', PAST_ANCHOR))).toBe(
      '2024-01-08T00:00:00.000Z',
    );
    const past = parseRussianDueDate('через неделю', PAST_ANCHOR);
    expect(past).not.toBeNull();
    expect(past!.getUTCFullYear()).toBe(2024);
    expect(past!.getTime()).toBeLessThan(Date.now());
  });

  it('невалидный/непонятный ввод → null', () => {
    expect(parseRussianDueDate('', NOW)).toBeNull();
    expect(parseRussianDueDate('   ', NOW)).toBeNull();
    expect(parseRussianDueDate('когда-нибудь потом', NOW)).toBeNull();
    expect(parseRussianDueDate('2026-13-40', NOW)).toBeNull();
    expect(parseRussianDueDate('32.13.2026', NOW)).toBeNull();
    expect(parseRussianDueDate('30 февраля', NOW)).toBeNull();
    expect(parseRussianDueDate('99 июня', NOW)).toBeNull();
  });
});
