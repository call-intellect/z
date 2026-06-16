import { describe, expect, it } from 'vitest';

import {
  computeCombinedSeverity,
  derivePersonRiskLevel,
  normalizeBusFactorLevel,
} from './knowledge-at-risk.scoring';

describe('knowledge-at-risk.scoring', () => {
  describe('computeCombinedSeverity', () => {
    it('critical bus-factor + high риск ухода → critical', () => {
      expect(computeCombinedSeverity('critical', 'high')).toBe('critical');
    });

    it('critical bus-factor + medium риск → critical', () => {
      expect(computeCombinedSeverity('critical', 'medium')).toBe('critical');
    });

    it('critical bus-factor + низкий/нет риска → warning (соло-эксперт, но не уходит)', () => {
      expect(computeCombinedSeverity('critical', 'low')).toBe('warning');
      expect(computeCombinedSeverity('critical', null)).toBe('warning');
    });

    it('warning bus-factor + high/medium риск → warning', () => {
      expect(computeCombinedSeverity('warning', 'high')).toBe('warning');
      expect(computeCombinedSeverity('warning', 'medium')).toBe('warning');
    });

    it('warning bus-factor + низкий риск → ok', () => {
      expect(computeCombinedSeverity('warning', 'low')).toBe('ok');
      expect(computeCombinedSeverity('warning', null)).toBe('ok');
    });

    it('ok bus-factor → всегда ok', () => {
      expect(computeCombinedSeverity('ok', 'high')).toBe('ok');
      expect(computeCombinedSeverity('ok', null)).toBe('ok');
    });
  });

  describe('derivePersonRiskLevel', () => {
    it('хотя бы один high-флаг → high', () => {
      expect(
        derivePersonRiskLevel({
          riskFlags: [{ severity: 'low' }, { severity: 'high' }],
          engagementScore: 0.9,
        }),
      ).toBe('high');
    });

    it('medium-флаг (без high) → medium', () => {
      expect(
        derivePersonRiskLevel({
          riskFlags: [{ severity: 'medium' }],
          engagementScore: 0.9,
        }),
      ).toBe('medium');
    });

    it('низкий engagementScore (<0.4) без флагов → medium', () => {
      expect(derivePersonRiskLevel({ riskFlags: [], engagementScore: 0.3 })).toBe('medium');
    });

    it('нет флагов + хороший engagement → low', () => {
      expect(derivePersonRiskLevel({ riskFlags: [], engagementScore: 0.8 })).toBe('low');
    });

    it('engagementScore=null + нет флагов → low', () => {
      expect(derivePersonRiskLevel({ riskFlags: [], engagementScore: null })).toBe('low');
    });
  });

  describe('normalizeBusFactorLevel', () => {
    it('критический/предупреждение/ок распознаются, мусор → ok', () => {
      expect(normalizeBusFactorLevel('critical')).toBe('critical');
      expect(normalizeBusFactorLevel('warning')).toBe('warning');
      expect(normalizeBusFactorLevel('ok')).toBe('ok');
      expect(normalizeBusFactorLevel('garbage')).toBe('ok');
      expect(normalizeBusFactorLevel(null)).toBe('ok');
    });
  });
});
