import { describe, expect, it } from 'vitest';

import { shouldReactivateInsight } from './insight-recheck.scoring';

/**
 * TZ-1 Фаза 4.B (daily-value-engine) — unit-тесты re-check митигированных
 * инсайтов. Без БД; время аргументом.
 */
describe('insight-recheck.scoring → shouldReactivateInsight', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');
  const mitigatedLongAgo = new Date('2026-05-01T00:00:00.000Z'); // > 14 дней

  it('mitigated + прошло >= recheck_days + есть повтор → реактивировать', () => {
    expect(
      shouldReactivateInsight(
        {
          status: 'mitigated',
          mitigatedAt: mitigatedLongAgo,
          lastObservedAt: mitigatedLongAgo,
          recentRecurringBlockCount: 2,
        },
        now,
        14,
      ),
    ).toBe(true);
  });

  it('mitigated, но повтора нет → НЕ реактивировать', () => {
    expect(
      shouldReactivateInsight(
        {
          status: 'mitigated',
          mitigatedAt: mitigatedLongAgo,
          lastObservedAt: mitigatedLongAgo,
          recentRecurringBlockCount: 0,
        },
        now,
        14,
      ),
    ).toBe(false);
  });

  it('mitigated + повтор, но прошло < recheck_days → ещё рано, НЕ реактивировать', () => {
    const recent = new Date('2026-06-06T00:00:00.000Z'); // 2 дня назад
    expect(
      shouldReactivateInsight(
        {
          status: 'mitigated',
          mitigatedAt: recent,
          lastObservedAt: recent,
          recentRecurringBlockCount: 3,
        },
        now,
        14,
      ),
    ).toBe(false);
  });

  it('статус не mitigated (active) → никогда не реактивируем через re-check', () => {
    expect(
      shouldReactivateInsight(
        {
          status: 'active',
          mitigatedAt: mitigatedLongAgo,
          lastObservedAt: mitigatedLongAgo,
          recentRecurringBlockCount: 5,
        },
        now,
        14,
      ),
    ).toBe(false);
  });

  it('mitigatedAt = null → берём lastObservedAt как точку отсчёта', () => {
    expect(
      shouldReactivateInsight(
        {
          status: 'mitigated',
          mitigatedAt: null,
          lastObservedAt: mitigatedLongAgo,
          recentRecurringBlockCount: 1,
        },
        now,
        14,
      ),
    ).toBe(true);
  });

  it('граница: ровно recheck_days назад + повтор → реактивировать (>=)', () => {
    const exactly14 = new Date(now.getTime() - 14 * 86_400_000);
    expect(
      shouldReactivateInsight(
        {
          status: 'mitigated',
          mitigatedAt: exactly14,
          lastObservedAt: exactly14,
          recentRecurringBlockCount: 1,
        },
        now,
        14,
      ),
    ).toBe(true);
  });
});
