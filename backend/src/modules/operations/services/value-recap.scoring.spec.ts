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

/**
 * TZ-1 Фаза 5 (daily-value-engine) — unit-тесты чистой логики value-recap.
 *
 * Покрываем:
 *   1. дельта к прошлому месяцу (baseline → null);
 *   2. ЧЕСТНОСТЬ (Р6) — assert NO forbidden metric keys в собранном payload
 *      (нет ₽/часы×ставка, было→стало, medianHoursToAnswer, roiScore/alignment);
 *   3. allow-list — throughputPercent / helpedRate НЕ считаются запрещёнными;
 *   4. детектор ловит подсунутый запрещённый ключ.
 */
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
    reliabilityPercent: 80,
    reliabilityDenominator: 10,
    reliabilityDelta: 5,
    chatHelpedRatePercent: 75,
    chatRated: 12,
    chatAnsweredWithCitation: 22,
    decisionsTotal: 8,
    decisionsThroughputPercent: 50,
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
        decisions: [
          { id: 'd1', statement: 'Решение A', status: 'done', throughputPercent: 100 },
          { id: 'd2', statement: 'Решение B', status: 'stalled', throughputPercent: 0 },
        ],
        narrative: 'За май система собрала встречи, задачи и решения.',
      });
      expect(payload.isBaseline).toBe(true);
      expect(payload.delta).toBeNull();
      expect(payload.decisions).toHaveLength(2);
      // КЛЮЧЕВОЙ assert честности: запрещённых наружу метрик в payload НЕТ
      // (вкл. decisions[].throughputPercent — он в allow-list).
      expect(findForbiddenMetricKeys(payload)).toEqual([]);
    });

    it('count решений идёт в паре с throughputPercent', () => {
      const payload = assembleValueRecapPayload({
        periodYm: '2026-05',
        builtAt: new Date('2026-06-01T07:00:00.000Z'),
        routine,
        team,
        previousRoutine: routine,
        decisions: [],
        narrative: 'ок',
      });
      expect(payload.team.decisionsTotal).toBe(8);
      expect(payload.team.decisionsThroughputPercent).toBe(50);
      expect(payload.isBaseline).toBe(false);
      expect(payload.delta).not.toBeNull();
    });
  });

  describe('findForbiddenMetricKeys', () => {
    it('allow-list: throughputPercent/helpedRate/reliabilityPercent НЕ запрещены', () => {
      const ok = {
        throughputPercent: 50,
        helpedRatePercent: 75,
        reliabilityPercent: 80,
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
      expect(findForbiddenMetricKeys({ medianHoursToAnswer: 2 })).toContain(
        'medianHoursToAnswer',
      );
      expect(findForbiddenMetricKeys({ beforeAfter: {} })).toContain('beforeAfter');
      expect(findForbiddenMetricKeys({ knowledgeSaved: 5 })).toContain('knowledgeSaved');
      // часы×ставка — поле «rate».
      expect(findForbiddenMetricKeys({ hourlyRate: 50 })).toContain('hourlyRate');
    });

    it('assertNoForbiddenMetricKeys бросает при подсунутом запрещённом ключе', () => {
      expect(() => assertNoForbiddenMetricKeys({ savedMoney: 1 })).toThrow();
    });

    it('обходит вложенность и массивы', () => {
      expect(
        findForbiddenMetricKeys({ a: { b: [{ roiScore: 1 }] } }),
      ).toContain('roiScore');
    });
  });
});
