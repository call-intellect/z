import { describe, expect, it } from 'vitest';

import {
  classifyRisk,
  computeRiskScore,
  DEFAULT_CUSTOMER_RISK_THRESHOLDS,
  DEFAULT_CUSTOMER_RISK_WEIGHTS,
  emptySignalCounts,
} from './customer-risk.scoring';

describe('customer-risk.scoring', () => {
  describe('computeRiskScore', () => {
    it('взвешивает каждый сигнал своим весом (churn весомее всего)', () => {
      const counts = {
        churn_risk: 2,
        objection: 1,
        pain: 3,
        feature_request: 4,
      };
      expect(computeRiskScore(counts, DEFAULT_CUSTOMER_RISK_WEIGHTS)).toBe(23);
    });

    it('нулевые счётчики → 0', () => {
      expect(computeRiskScore(emptySignalCounts(), DEFAULT_CUSTOMER_RISK_WEIGHTS)).toBe(0);
    });

    it('один churn_risk = вес churn_risk', () => {
      expect(
        computeRiskScore(
          { churn_risk: 1, objection: 0, pain: 0, feature_request: 0 },
          DEFAULT_CUSTOMER_RISK_WEIGHTS,
        ),
      ).toBe(5);
    });

    it('негатив: отрицательные счётчики трактуются как 0', () => {
      expect(
        computeRiskScore(
          { churn_risk: -3, objection: 2, pain: 0, feature_request: 0 },
          DEFAULT_CUSTOMER_RISK_WEIGHTS,
        ),
      ).toBe(6);
    });

    it('негатив: NaN/Infinity в весах → 0 вклад', () => {
      expect(
        computeRiskScore(
          { churn_risk: 1, objection: 1, pain: 0, feature_request: 0 },
          {
            churn_risk: Number.NaN,
            objection: Number.POSITIVE_INFINITY,
            pain: 2,
            feature_request: 1,
          },
        ),
      ).toBe(0);
    });

    it('кастомные веса меняют ранжирование без кода', () => {
      const counts = {
        churn_risk: 0,
        objection: 0,
        pain: 0,
        feature_request: 10,
      };
      expect(
        computeRiskScore(counts, {
          churn_risk: 5,
          objection: 3,
          pain: 2,
          feature_request: 4,
        }),
      ).toBe(40);
    });
  });

  describe('classifyRisk', () => {
    const t = DEFAULT_CUSTOMER_RISK_THRESHOLDS;

    it('score >= critical → critical (граница включена)', () => {
      expect(classifyRisk(10, t)).toBe('critical');
      expect(classifyRisk(10.0001, t)).toBe('critical');
      expect(classifyRisk(100, t)).toBe('critical');
    });

    it('warning <= score < critical → warning (граница включена снизу)', () => {
      expect(classifyRisk(4, t)).toBe('warning');
      expect(classifyRisk(9.9999, t)).toBe('warning');
    });

    it('score < warning → ok', () => {
      expect(classifyRisk(3.9999, t)).toBe('ok');
      expect(classifyRisk(0, t)).toBe('ok');
    });

    it('негатив: NaN score → ok (0)', () => {
      expect(classifyRisk(Number.NaN, t)).toBe('ok');
    });

    it('кастомные пороги работают', () => {
      expect(classifyRisk(5, { critical: 5, warning: 2 })).toBe('critical');
      expect(classifyRisk(3, { critical: 5, warning: 2 })).toBe('warning');
    });
  });
});
