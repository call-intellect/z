import { describe, expect, it } from 'vitest';

import {
  BadgeConditionsService,
  type ContributionSnapshotForBadge,
} from './badge-conditions.service';

function emptySnapshot(): ContributionSnapshotForBadge {
  return {
    ideasInDevelopment: 0,
    ideasShipped: 0,
    thanksReceived: 0,
    thanksReceivedWeek: 0,
    helpfulComments: 0,
    probeQuestionsAnswered: 0,
    currentCheckinStreak: 0,
    longestCheckinStreak: 0,
  };
}

describe('BadgeConditionsService', () => {
  const svc = new BadgeConditionsService();

  it('возвращает true когда ideas_in_dev достигает threshold', () => {
    const snap = { ...emptySnapshot(), ideasInDevelopment: 5 };
    expect(svc.evaluate({ type: 'ideas_in_dev', threshold: 5 }, snap)).toBe(true);
  });

  it('возвращает false когда ideas_in_dev ниже threshold', () => {
    const snap = { ...emptySnapshot(), ideasInDevelopment: 4 };
    expect(svc.evaluate({ type: 'ideas_in_dev', threshold: 5 }, snap)).toBe(false);
  });

  it('thanks_received: проверяет thanksReceived', () => {
    const snap = { ...emptySnapshot(), thanksReceived: 10 };
    expect(svc.evaluate({ type: 'thanks_received', threshold: 10 }, snap)).toBe(true);
    expect(svc.evaluate({ type: 'thanks_received', threshold: 11 }, snap)).toBe(false);
  });

  it('helpful_comments: проверяет helpfulComments', () => {
    const snap = { ...emptySnapshot(), helpfulComments: 20 };
    expect(svc.evaluate({ type: 'helpful_comments', threshold: 20 }, snap)).toBe(true);
    expect(svc.evaluate({ type: 'helpful_comments', threshold: 21 }, snap)).toBe(false);
  });

  it('checkin_streak: проверяет currentCheckinStreak (не longest!)', () => {
    const snap = {
      ...emptySnapshot(),
      currentCheckinStreak: 14,
      longestCheckinStreak: 100,
    };
    expect(svc.evaluate({ type: 'checkin_streak', threshold: 14 }, snap)).toBe(true);
    expect(svc.evaluate({ type: 'checkin_streak', threshold: 15 }, snap)).toBe(false);
  });

  it('goal_alignment: всегда false (TODO — нет данных Goal alignment)', () => {
    const snap = emptySnapshot();
    expect(svc.evaluate({ type: 'goal_alignment', threshold: 90 }, snap)).toBe(false);
  });

  it('неподдерживаемый type → false (no-op)', () => {
    const snap = emptySnapshot();
    expect(svc.evaluate({ type: 'unknown', threshold: 1 } as unknown, snap)).toBe(
      false,
    );
  });

  it('некорректный condition (null, строка, без threshold) → false', () => {
    const snap = emptySnapshot();
    expect(svc.evaluate(null, snap)).toBe(false);
    expect(svc.evaluate('garbage', snap)).toBe(false);
    expect(svc.evaluate({ type: 'thanks_received' }, snap)).toBe(false);
    expect(svc.evaluate({ threshold: 5 }, snap)).toBe(false);
  });

  it('isCondition: type-guard корректно различает', () => {
    expect(svc.isCondition({ type: 'ideas_in_dev', threshold: 5 })).toBe(true);
    expect(svc.isCondition({ type: 'unknown', threshold: 5 })).toBe(false);
    expect(svc.isCondition({ type: 'ideas_in_dev', threshold: NaN })).toBe(false);
    expect(svc.isCondition(undefined)).toBe(false);
  });
});
