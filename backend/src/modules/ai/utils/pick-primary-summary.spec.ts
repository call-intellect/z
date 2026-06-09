import { describe, expect, it } from 'vitest';

import { pickPrimarySummary } from './pick-primary-summary';

describe('pickPrimarySummary (Р6 — каноническая сводка)', () => {
  it('summaryFast приоритетнее summaryV2 и summary', () => {
    expect(
      pickPrimarySummary({
        summaryFast: 'FAST',
        summaryV2: 'V2',
        summary: 'LEGACY',
      }),
    ).toBe('FAST');
  });

  it('summaryFast пустой/whitespace → берём summaryV2', () => {
    expect(
      pickPrimarySummary({
        summaryFast: '   ',
        summaryV2: 'V2',
        summary: 'LEGACY',
      }),
    ).toBe('V2');
  });

  it('summaryFast null → берём summaryV2', () => {
    expect(
      pickPrimarySummary({
        summaryFast: null,
        summaryV2: 'V2',
        summary: 'LEGACY',
      }),
    ).toBe('V2');
  });

  it('summaryFast и summaryV2 пустые → берём legacy summary', () => {
    expect(
      pickPrimarySummary({
        summaryFast: null,
        summaryV2: '',
        summary: 'LEGACY',
      }),
    ).toBe('LEGACY');
  });

  it('всё пусто/null → пустая строка', () => {
    expect(
      pickPrimarySummary({ summaryFast: null, summaryV2: null, summary: '' }),
    ).toBe('');
    expect(pickPrimarySummary({})).toBe('');
    expect(
      pickPrimarySummary({
        summaryFast: '  ',
        summaryV2: '  ',
        summary: '  ',
      }),
    ).toBe('');
  });

  it('тримит выбранную сводку', () => {
    expect(pickPrimarySummary({ summaryFast: '  FAST  ' })).toBe('FAST');
  });
});
