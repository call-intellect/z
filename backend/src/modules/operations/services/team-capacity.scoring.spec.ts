import { describe, expect, it } from 'vitest';

import {
  classifyCapacity,
  DEFAULT_CAPACITY_THRESHOLDS,
} from './team-capacity.scoring';

/**
 * TZ-1 Фаза 4.D (daily-value-engine) — unit-тесты классификации загрузки команды.
 * Без БД.
 */
describe('team-capacity.scoring → classifyCapacity', () => {
  const t = DEFAULT_CAPACITY_THRESHOLDS; // overload 120, underload 50

  it('загрузка строго > overload → overload', () => {
    expect(classifyCapacity(121, t)).toBe('overload');
    expect(classifyCapacity(200, t)).toBe('overload');
  });

  it('загрузка строго < underload → underload', () => {
    expect(classifyCapacity(49, t)).toBe('underload');
    expect(classifyCapacity(0, t)).toBe('underload');
  });

  it('загрузка в норме → ok', () => {
    expect(classifyCapacity(100, t)).toBe('ok');
    expect(classifyCapacity(80, t)).toBe('ok');
  });

  it('граница == overload → ok (строгое неравенство)', () => {
    expect(classifyCapacity(120, t)).toBe('ok');
  });

  it('граница == underload → ok (строгое неравенство)', () => {
    expect(classifyCapacity(50, t)).toBe('ok');
  });

  it('кастомные пороги уважаются', () => {
    const custom = { overloadPercent: 90, underloadPercent: 30 };
    expect(classifyCapacity(95, custom)).toBe('overload');
    expect(classifyCapacity(20, custom)).toBe('underload');
    expect(classifyCapacity(60, custom)).toBe('ok');
  });

  it('мусорный loadPercent (NaN) → ok (0 трактуется в норме при дефолте? нет — 0<50 → underload)', () => {
    // NaN → 0 → 0 < underload(50) → underload
    expect(classifyCapacity(Number.NaN, t)).toBe('underload');
  });
});
