import { describe, expect, it } from 'vitest';

import { fmtDurationCompact } from '../format-utils';

describe('fmtDurationCompact', () => {
  it('некорректная/нулевая/отрицательная длительность → «—»', () => {
    expect(fmtDurationCompact(0)).toBe('—');
    expect(fmtDurationCompact(null)).toBe('—');
    expect(fmtDurationCompact(undefined)).toBe('—');
    expect(fmtDurationCompact(-1000)).toBe('—');
  });

  it('суб-минутная длительность → «<1 мин» (S6-12)', () => {
    expect(fmtDurationCompact(47000)).toBe('<1 мин');
    expect(fmtDurationCompact(30000)).toBe('<1 мин');
    expect(fmtDurationCompact(59999)).toBe('<1 мин');
  });

  it('минуты без часов → «Nм»', () => {
    expect(fmtDurationCompact(60000)).toBe('1м');
    expect(fmtDurationCompact(90000)).toBe('1м');
    expect(fmtDurationCompact(600000)).toBe('10м');
  });

  it('часы → «Hч MMм»', () => {
    expect(fmtDurationCompact(3700000)).toBe('1ч 01м');
  });
});
