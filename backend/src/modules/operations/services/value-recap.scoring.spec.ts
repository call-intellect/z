import { describe, expect, it } from 'vitest';

import {
  assembleValueRecapPayload,
  assertNoForbiddenMetricKeys,
  buildDelta,
  computeCounterDelta,
  findForbiddenMetricKeys,
  type ValueRecapRoutine,
  type ValueRecapTeam,
} from './value-recap.scoring';

describe('value-recap.scoring', () => {
  const routine: ValueRecapRoutine = {
    meetingsAutoProtocoled: 12,
    tasksExtracted: 40,
    decisionsExtracted: 8,
    commitmentsExtracted: 15,
    statusesCollected: 60,
    questionsAnsweredWithCitation: 22,
    ideasShipped: 3,
  };

  const team: ValueRecapTeam = {
    chatHelpedRatePercent: 75,
    chatRated: 12,
    chatAnsweredWithCitation: 22,
    ideasShipped: 3,
    estimate: true,
  };

  describe('computeCounterDelta', () => {
    it('previous=null → null (baseline, без атрибуции)', () => {
      expect(computeCounterDelta(10, null)).toBeNull();
    });
    it('считает дельту', () => {
      expect(computeCounterDelta(12, 8)).toBe(4);
      expect(computeCounterDelta(5, 9)).toBe(-4);
    });
  });

  describe('buildDelta', () => {
    it('previous=null → весь delta null', () => {
      expect(buildDelta(routine, null)).toBeNull();
    });
    it('считает дельту по ведущим счётчикам', () => {
      const prev: ValueRecapRoutine = { ...routine, meetingsAutoProtocoled: 8, tasksExtracted: 50 };
      const d = buildDelta(routine, prev);
      expect(d?.meetingsAutoProtocoled).toBe(4);
      expect(d?.tasksExtracted).toBe(-10);
    });
  });

  describe('assembleValueRecapPayload (ЧЕСТНОСТЬ Р6)', () => {
    it('собирает payload без запрещённых метрик; baseline при previous=null', () => {
      const payload = assembleValueRecapPayload({
        periodYm: '2026-05',
        builtAt: new Date('2026-06-01T07:00:00.000Z'),
        routine,
        team,
        previousRoutine: null,
        narrative: 'За май система собрала встречи, задачи и решения.',
      });
      expect(payload.isBaseline).toBe(true);
      expect(payload.delta).toBeNull();
      expect(payload.routine.decisionsExtracted).toBe(8);
      expect(findForbiddenMetricKeys(payload)).toEqual([]);
    });

    it('previous=routine → дельта считается, baseline=false', () => {
      const payload = assembleValueRecapPayload({
        periodYm: '2026-05',
        builtAt: new Date('2026-06-01T07:00:00.000Z'),
        routine,
        team,
        previousRoutine: routine,
        narrative: 'ок',
      });
      expect(payload.isBaseline).toBe(false);
      expect(payload.delta).not.toBeNull();
    });
  });

  describe('findForbiddenMetricKeys', () => {
    it('allow-list: helpedRate НЕ запрещён', () => {
      const ok = {
        helpedRatePercent: 75,
        feedbackCoveragePercent: 40,
        estimate: true,
      };
      expect(findForbiddenMetricKeys(ok)).toEqual([]);
    });

    it('ловит запрещённые ключи (₽/часы×ставка/roi/before-after/medianHoursToAnswer)', () => {
      expect(findForbiddenMetricKeys({ savedRubles: 1000 })).toContain('savedRubles');
      expect(findForbiddenMetricKeys({ hoursSaved: 42 })).toContain('hoursSaved');
      expect(findForbiddenMetricKeys({ roiScore: 3 })).toContain('roiScore');
      expect(findForbiddenMetricKeys({ alignmentScore: 0.7 })).toContain('alignmentScore');
      expect(findForbiddenMetricKeys({ medianHoursToAnswer: 2 })).toContain('medianHoursToAnswer');
      expect(findForbiddenMetricKeys({ beforeAfter: {} })).toContain('beforeAfter');
      expect(findForbiddenMetricKeys({ knowledgeSaved: 5 })).toContain('knowledgeSaved');
      expect(findForbiddenMetricKeys({ hourlyRate: 50 })).toContain('hourlyRate');
    });

    it('assertNoForbiddenMetricKeys бросает при подсунутом запрещённом ключе', () => {
      expect(() => assertNoForbiddenMetricKeys({ savedMoney: 1 })).toThrow();
    });

    it('обходит вложенность и массивы', () => {
      expect(findForbiddenMetricKeys({ a: { b: [{ roiScore: 1 }] } })).toContain('roiScore');
    });
  });
});
