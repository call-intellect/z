import { describe, expect, it } from 'vitest';

import {
  buildChatUsageStats,
  computeHelpedRate,
  DEFAULT_CHAT_FEEDBACK_MIN_RATED,
  shouldHideRate,
} from './chat-usage-stats.scoring';

describe('chat-usage-stats.scoring', () => {
  describe('computeHelpedRate', () => {
    it('helpedUp/rated в процентах (НЕ /answered)', () => {
      expect(computeHelpedRate(7, 10)).toBe(70);
      expect(computeHelpedRate(1, 3)).toBe(33);
    });

    it('rated<=0 → null', () => {
      expect(computeHelpedRate(0, 0)).toBeNull();
      expect(computeHelpedRate(5, 0)).toBeNull();
      expect(computeHelpedRate(5, -1)).toBeNull();
    });

    it('helpedUp не превышает rated (клампится)', () => {
      expect(computeHelpedRate(20, 10)).toBe(100);
    });
  });

  describe('shouldHideRate', () => {
    it('rated < min → скрыть', () => {
      expect(shouldHideRate(9, 10)).toBe(true);
      expect(shouldHideRate(0, 10)).toBe(true);
    });
    it('rated >= min → показать', () => {
      expect(shouldHideRate(10, 10)).toBe(false);
      expect(shouldHideRate(50, 10)).toBe(false);
    });
  });

  describe('buildChatUsageStats', () => {
    it('rated < 10 → helpedRatePercent скрыт (null, hidden=true)', () => {
      const s = buildChatUsageStats({
        asked: 20,
        answered: 18,
        answeredWithCitation: 12,
        rated: 5,
        helpedUp: 5,
      });
      expect(s.helpedRatePercent).toBeNull();
      expect(s.helpedRateHidden).toBe(true);
      expect(s.minRated).toBe(DEFAULT_CHAT_FEEDBACK_MIN_RATED);
    });

    it('rated >= 10 → helpedRatePercent виден, считается от rated', () => {
      const s = buildChatUsageStats({
        asked: 40,
        answered: 38,
        answeredWithCitation: 25,
        rated: 20,
        helpedUp: 15,
      });
      expect(s.helpedRateHidden).toBe(false);
      expect(s.helpedRatePercent).toBe(75);
    });

    it('feedbackCoverage = rated/answered; groundedRate = withCitation/answered', () => {
      const s = buildChatUsageStats({
        asked: 50,
        answered: 40,
        answeredWithCitation: 30,
        rated: 20,
        helpedUp: 10,
      });
      expect(s.feedbackCoveragePercent).toBe(50);
      expect(s.groundedRatePercent).toBe(75);
    });

    it('answered=0 → coverage/grounded = 0, helped скрыт', () => {
      const s = buildChatUsageStats({
        asked: 0,
        answered: 0,
        answeredWithCitation: 0,
        rated: 0,
        helpedUp: 0,
      });
      expect(s.feedbackCoveragePercent).toBe(0);
      expect(s.groundedRatePercent).toBe(0);
      expect(s.helpedRatePercent).toBeNull();
    });

    it('answeredWithCitation клампится к answered', () => {
      const s = buildChatUsageStats({
        asked: 10,
        answered: 5,
        answeredWithCitation: 99,
        rated: 0,
        helpedUp: 0,
      });
      expect(s.answeredWithCitation).toBe(5);
      expect(s.groundedRatePercent).toBe(100);
    });

    it('кастомный minRated уважается', () => {
      const s = buildChatUsageStats(
        {
          asked: 10,
          answered: 8,
          answeredWithCitation: 4,
          rated: 4,
          helpedUp: 3,
        },
        3,
      );
      expect(s.helpedRateHidden).toBe(false);
      expect(s.helpedRatePercent).toBe(75);
    });
  });
});
