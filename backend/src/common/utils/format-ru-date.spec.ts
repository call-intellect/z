import { describe, expect, it } from 'vitest';

import { formatRuDate } from './format-ru-date';

describe('formatRuDate', () => {
  it('форматирует дату YYYY-MM-DD в «день месяц(род.)»', () => {
    expect(formatRuDate('2026-06-19')).toBe('19 июня');
    expect(formatRuDate('2026-01-01')).toBe('1 января');
    expect(formatRuDate('2026-12-31')).toBe('31 декабря');
  });

  it('форматирует ISO-datetime с временем', () => {
    expect(formatRuDate('2026-06-19T14:30:00.000Z')).toBe('19 июня, 14:30');
  });

  it('пустое/undefined → пустая строка', () => {
    expect(formatRuDate('')).toBe('');
    expect(formatRuDate(undefined)).toBe('');
    expect(formatRuDate(null)).toBe('');
  });

  it('неразбираемое значение возвращается как есть', () => {
    expect(formatRuDate('завтра')).toBe('завтра');
    expect(formatRuDate('2026-13-40')).toBe('2026-13-40');
  });
});
