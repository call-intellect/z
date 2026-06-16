import { describe, expect, it } from 'vitest';

import { isOnboardingStalled } from './onboarding-ramp.scoring';

describe('onboarding-ramp.scoring → isOnboardingStalled', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');
  const day = 86_400_000;
  const silentDays = 5;

  it('новичок 6 дней + 0 активности → stalled', () => {
    expect(
      isOnboardingStalled({
        createdAt: new Date(now.getTime() - 6 * day),
        firstActivityAt: null,
        silentDays,
        now,
      }),
    ).toBe(true);
  });

  it('новичок 6 дней + активность была в первые 2 дня → НЕ stalled (включился)', () => {
    const createdAt = new Date(now.getTime() - 6 * day);
    expect(
      isOnboardingStalled({
        createdAt,
        firstActivityAt: new Date(createdAt.getTime() + 2 * day),
        silentDays,
        now,
      }),
    ).toBe(false);
  });

  it('новичок 6 дней + первая активность только на 5-й день → stalled (молчал окно)', () => {
    const createdAt = new Date(now.getTime() - 6 * day);
    expect(
      isOnboardingStalled({
        createdAt,
        firstActivityAt: new Date(createdAt.getTime() + 5 * day),
        silentDays,
        now,
      }),
    ).toBe(true);
  });

  it('ещё рано (2 дня < silentDays) → НЕ stalled', () => {
    expect(
      isOnboardingStalled({
        createdAt: new Date(now.getTime() - 2 * day),
        firstActivityAt: null,
        silentDays,
        now,
      }),
    ).toBe(false);
  });

  it('уже поздно (вышел за окно 2×silentDays) → НЕ stalled (не новичок)', () => {
    expect(
      isOnboardingStalled({
        createdAt: new Date(now.getTime() - 11 * day),
        firstActivityAt: null,
        silentDays,
        now,
      }),
    ).toBe(false);
  });

  it('граница: ровно silentDays + 0 активности → stalled (>=)', () => {
    expect(
      isOnboardingStalled({
        createdAt: new Date(now.getTime() - silentDays * day),
        firstActivityAt: null,
        silentDays,
        now,
      }),
    ).toBe(true);
  });
});
