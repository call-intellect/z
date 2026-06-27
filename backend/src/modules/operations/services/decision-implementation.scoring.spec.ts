import { describe, expect, it } from 'vitest';

import {
  classifyImplementationStatus,
  computeDecisionThroughput,
  isDecisionStalled,
} from './decision-implementation.scoring';

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
          impliesAction: true,
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
          impliesAction: true,
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
          impliesAction: true,
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
          impliesAction: true,
        }),
      ).toBe('not_started');
    });
    it('impliesAction=false + старое без задач/outcomes → not_started (НЕ stalled)', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 30,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
          impliesAction: false,
        }),
      ).toBe('not_started');
    });
    it('impliesAction=true + те же условия → stalled (регресс прежнего поведения)', () => {
      expect(
        classifyImplementationStatus({
          ageDays: 30,
          linkedTaskCount: 0,
          hasOutcomes: false,
          staleDays: 21,
          impliesAction: true,
        }),
      ).toBe('stalled');
    });
  });

  describe('computeDecisionThroughput', () => {
    it('% доведённых = done/total × 100', () => {
      expect(computeDecisionThroughput({ total: 10, doneWithOutcomes: 4 })).toEqual({
        total: 10,
        doneWithOutcomes: 4,
        throughputPercent: 40,
      });
    });
    it('total=0 → 0% (без деления на ноль)', () => {
      expect(computeDecisionThroughput({ total: 0, doneWithOutcomes: 0 })).toEqual({
        total: 0,
        doneWithOutcomes: 0,
        throughputPercent: 0,
      });
    });
    it('done не может превысить total (clamp)', () => {
      expect(computeDecisionThroughput({ total: 3, doneWithOutcomes: 5 })).toEqual({
        total: 3,
        doneWithOutcomes: 3,
        throughputPercent: 100,
      });
    });
    it('округление до 1 знака', () => {
      expect(computeDecisionThroughput({ total: 3, doneWithOutcomes: 1 }).throughputPercent).toBe(
        33.3,
      );
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
