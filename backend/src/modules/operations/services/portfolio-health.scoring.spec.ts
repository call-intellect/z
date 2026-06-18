import { describe, expect, it } from 'vitest';

import {
  classifyPortfolioLevel,
  computePortfolioHealth,
  DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS,
  DEFAULT_PORTFOLIO_HEALTH_WEIGHTS,
  emptyByStatus,
} from './portfolio-health.scoring';

describe('portfolio-health.scoring', () => {
  describe('computePortfolioHealth', () => {
    it('total=0 → score 0', () => {
      expect(computePortfolioHealth(emptyByStatus(), DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(0);
    });

    it('все achieved → 100 (вес achieved = 100)', () => {
      const byStatus = {
        on_track: 0,
        at_risk: 0,
        stalled: 0,
        achieved: 4,
        dropped: 0,
      };
      expect(computePortfolioHealth(byStatus, DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(100);
    });

    it('все stalled → 0 (вес stalled = 0)', () => {
      const byStatus = {
        on_track: 0,
        at_risk: 0,
        stalled: 3,
        achieved: 0,
        dropped: 0,
      };
      expect(computePortfolioHealth(byStatus, DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(0);
    });

    it('взвешенное среднее: 1 achieved(100)+1 on_track(80)+1 at_risk(40)+1 stalled(0) = 220/4 = 55', () => {
      const byStatus = {
        on_track: 1,
        at_risk: 1,
        stalled: 1,
        achieved: 1,
        dropped: 0,
      };
      expect(computePortfolioHealth(byStatus, DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(55);
    });

    it('округляет до целого', () => {
      const byStatus = {
        on_track: 1,
        at_risk: 0,
        stalled: 0,
        achieved: 0,
        dropped: 2,
      };
      expect(computePortfolioHealth(byStatus, DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(27);
    });

    it('зажимает в [0,100] даже при весе > 100', () => {
      const byStatus = {
        on_track: 0,
        at_risk: 0,
        stalled: 0,
        achieved: 2,
        dropped: 0,
      };
      const score = computePortfolioHealth(byStatus, {
        achieved: 500,
        on_track: 0,
        at_risk: 0,
        stalled: 0,
        dropped: 0,
      });
      expect(score).toBe(100);
    });

    it('мусорные/отрицательные счётчики трактуются как 0', () => {
      const byStatus = {
        on_track: -5 as number,
        at_risk: Number.NaN as unknown as number,
        stalled: 0,
        achieved: 2,
        dropped: 0,
      };
      expect(computePortfolioHealth(byStatus, DEFAULT_PORTFOLIO_HEALTH_WEIGHTS)).toBe(100);
    });
  });

  describe('classifyPortfolioLevel', () => {
    it('>= healthy → healthy', () => {
      expect(classifyPortfolioLevel(60, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('healthy');
      expect(classifyPortfolioLevel(75, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('healthy');
    });

    it('>= warning и < healthy → warning', () => {
      expect(classifyPortfolioLevel(40, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('warning');
      expect(classifyPortfolioLevel(59, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('warning');
    });

    it('< warning → critical', () => {
      expect(classifyPortfolioLevel(39, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('critical');
      expect(classifyPortfolioLevel(0, DEFAULT_PORTFOLIO_HEALTH_THRESHOLDS)).toBe('critical');
    });
  });
});
