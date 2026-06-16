import { SubscriptionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { allowedNextStatuses, assertCanTransition, canTransition } from './subscription-fsm';

const ALL_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.DEMO,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.SUSPENDED,
  SubscriptionStatus.CANCELED,
  SubscriptionStatus.EXPIRED,
];

const ALLOWED: Array<[SubscriptionStatus, SubscriptionStatus]> = [
  [SubscriptionStatus.DEMO, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED],
  [SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED],
  [SubscriptionStatus.SUSPENDED, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.SUSPENDED, SubscriptionStatus.EXPIRED],
  [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED],
  [SubscriptionStatus.CANCELED, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.EXPIRED, SubscriptionStatus.DEMO],
];

describe('SubscriptionFSM.canTransition', () => {
  it('каждый same-status переход → true (idempotent)', () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it.each(ALLOWED)('разрешает %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('все НЕ-разрешённые переходы → false', () => {
    const allowedSet = new Set(ALLOWED.map(([f, t]) => `${f}→${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        const key = `${from}→${to}`;
        if (allowedSet.has(key)) continue;
        expect(canTransition(from, to), `должен запрещать ${key}`).toBe(false);
      }
    }
  });

  it('DEMO → CANCELED / EXPIRED / SUSPENDED / PAST_DUE → false', () => {
    expect(canTransition(SubscriptionStatus.DEMO, SubscriptionStatus.CANCELED)).toBe(false);
    expect(canTransition(SubscriptionStatus.DEMO, SubscriptionStatus.EXPIRED)).toBe(false);
    expect(canTransition(SubscriptionStatus.DEMO, SubscriptionStatus.SUSPENDED)).toBe(false);
    expect(canTransition(SubscriptionStatus.DEMO, SubscriptionStatus.PAST_DUE)).toBe(false);
  });

  it('CANCELED → PAST_DUE → false (рекуррент уже выключен)', () => {
    expect(canTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.PAST_DUE)).toBe(false);
  });

  it('SUSPENDED → CANCELED → false (отменять нечего)', () => {
    expect(canTransition(SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELED)).toBe(false);
  });
});

describe('SubscriptionFSM.assertCanTransition', () => {
  it('не throw при разрешённом переходе', () => {
    expect(() =>
      assertCanTransition(SubscriptionStatus.DEMO, SubscriptionStatus.ACTIVE),
    ).not.toThrow();
  });

  it('не throw при same-status', () => {
    expect(() =>
      assertCanTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.ACTIVE),
    ).not.toThrow();
  });

  it('throw с понятным сообщением при запрещённом переходе', () => {
    expect(() => assertCanTransition(SubscriptionStatus.DEMO, SubscriptionStatus.EXPIRED)).toThrow(
      /Запрещённый переход FSM подписки: DEMO → EXPIRED/,
    );
    expect(() => assertCanTransition(SubscriptionStatus.DEMO, SubscriptionStatus.EXPIRED)).toThrow(
      /Допустимые из DEMO: ACTIVE/,
    );
  });
});

describe('SubscriptionFSM.allowedNextStatuses', () => {
  it('DEMO → [ACTIVE]', () => {
    expect(allowedNextStatuses(SubscriptionStatus.DEMO)).toEqual([SubscriptionStatus.ACTIVE]);
  });

  it('ACTIVE → [PAST_DUE, CANCELED, EXPIRED]', () => {
    expect(allowedNextStatuses(SubscriptionStatus.ACTIVE)).toEqual([
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.EXPIRED,
    ]);
  });

  it('EXPIRED → [ACTIVE, DEMO]', () => {
    expect(allowedNextStatuses(SubscriptionStatus.EXPIRED)).toEqual([
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.DEMO,
    ]);
  });
});
