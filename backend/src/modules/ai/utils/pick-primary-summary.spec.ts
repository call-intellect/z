import { describe, expect, it } from 'vitest';

import { pickPrimarySummary } from './pick-primary-summary';

describe('pickPrimarySummary (Р6 — каноническая сводка)', () => {
  it('summaryFast приоритетнее legacy summary', () => {
    expect(
      pickPrimarySummary({
        summaryFast: 'FAST',
        summary: 'LEGACY',
      }),
    ).toBe('FAST');
  });

  it('summaryFast пустой/whitespace → берём legacy summary', () => {
    expect(
      pickPrimarySummary({
        summaryFast: '   ',
        summary: 'LEGACY',
      }),
    ).toBe('LEGACY');
  });

  it('summaryFast null → берём legacy summary', () => {
    expect(
      pickPrimarySummary({
        summaryFast: null,
        summary: 'LEGACY',
      }),
    ).toBe('LEGACY');
  });

  it('всё пусто/null → пустая строка', () => {
    expect(pickPrimarySummary({ summaryFast: null, summary: '' })).toBe('');
    expect(pickPrimarySummary({})).toBe('');
    expect(
      pickPrimarySummary({
        summaryFast: '  ',
        summary: '  ',
      }),
    ).toBe('');
  });

  it('тримит выбранную сводку', () => {
    expect(pickPrimarySummary({ summaryFast: '  FAST  ' })).toBe('FAST');
  });
});
