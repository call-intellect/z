import { describe, expect, it } from 'vitest';

import {
  classifyImplementationStatus,
  computeDecisionThroughput,
  isDecisionStalled,
} from './decision-implementation.scoring';

/**
 * TZ-1 Фаза 3.B (daily-value-engine) — unit-тесты чистой логики контролёра
 * внедрения решений. Без БД/времени/сети.
 */
describe('decision-implementation.scoring', () => {
  describe('isDecisionStalled', () => {
    it('0 задач + нет outcomes + старше N дней → stalled', () => {
      expect(
        isDecisionStalled({
          ageDays: 30,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe(true);
    });

    it('есть outcomes → не stalled (даже старое и без задач)', () => {
      expect(
        isDecisionStalled({
          ageDays: 100,
          linkedTaskCount: 0,
          hasOutcomes: true,
          staleDays: 21,
        }),
      ).toBe(false);
    });

    it('есть связанные задачи → не stalled', () => {
      expect(
        isDecisionStalled({
          ageDays: 100,
          linkedTaskCount: 2,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe(false);
    });

    it('моложе порога → не stalled', () => {
      expect(
        isDecisionStalled({
          ageDays: 5,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe(false);
    });

    it('граница ageDays === staleDays включается (>=)', () => {
      expect(
        isDecisionStalled({
          ageDays: 21,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe(true);
    });
  });

  describe('classifyImplementationStatus', () => {
    it('есть outcomes → done', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 1,
          linkedTaskCount: 0,
          hasOutcomes: true,
          staleDays: 21,
        }),
      ).toBe('done');
    });
    it('старое без задач/outcomes → stalled', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 30,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe('stalled');
    });
    it('есть задачи без outcomes → in_progress', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 30,
          linkedTaskCount: 3,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe('in_progress');
    });
    it('молодое без задач/outcomes → not_started', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 2,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
        }),
      ).toBe('not_started');
    });
  });

  describe('computeDecisionThroughput', () => {
    it('% доведённых = done/total × 100', () => {
      expect(computeDecisionThroughput({ total: 10, doneWithOutcomes: 4 })).toEqual(
        { total: 10, doneWithOutcomes: 4, throughputPercent: 40 },
      );
    });
    it('total=0 → 0% (без деления на ноль)', () => {
      expect(computeDecisionThroughput({ total: 0, doneWithOutcomes: 0 })).toEqual(
        { total: 0, doneWithOutcomes: 0, throughputPercent: 0 },
      );
    });
    it('done не может превысить total (clamp)', () => {
      expect(
        computeDecisionThroughput({ total: 3, doneWithOutcomes: 5 }),
      ).toEqual({ total: 3, doneWithOutcomes: 3, throughputPercent: 100 });
    });
    it('округление до 1 знака', () => {
      // 1/3 = 33.33% → 33.3
      expect(
        computeDecisionThroughput({ total: 3, doneWithOutcomes: 1 })
          .throughputPercent,
      ).toBe(33.3);
    });
    it('мусорные значения → 0', () => {
      expect(
        computeDecisionThroughput({
          total: -5,
          doneWithOutcomes: Number.NaN,
        }),
      ).toEqual({ total: 0, doneWithOutcomes: 0, throughputPercent: 0 });
    });
  });
});
