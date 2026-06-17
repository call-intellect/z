import { describe, expect, it } from 'vitest';

import {
  detectMeetingNoshows,
  detectReplyLatencyRise,
  detectWorkloadOverload,
} from './burnout-risk-detector.cron';

describe('detectReplyLatencyRise (ТЗ-1 Ф3.D.3)', () => {
  it('baseline <= 0 → false (нет данных для роста)', () => {
    expect(detectReplyLatencyRise(1000, 0, 2)).toBe(false);
    expect(detectReplyLatencyRise(1000, -5, 2)).toBe(false);
  });
  it('recent >= baseline*factor → true (на границе)', () => {
    expect(detectReplyLatencyRise(7_200_000, 3_600_000, 2)).toBe(true);
    expect(detectReplyLatencyRise(10_000_000, 3_600_000, 2)).toBe(true);
  });
  it('recent < baseline*factor → false (чуть ниже границы)', () => {
    expect(detectReplyLatencyRise(7_199_999, 3_600_000, 2)).toBe(false);
    expect(detectReplyLatencyRise(3_600_000, 3_600_000, 2)).toBe(false);
  });
});

describe('detectWorkloadOverload (ТЗ-1 Ф3.D.3)', () => {
  it('loadPercent строго > порога → true', () => {
    expect(detectWorkloadOverload(121, 120)).toBe(true);
    expect(detectWorkloadOverload(200, 120)).toBe(true);
  });
  it('loadPercent == порога → false (нужно строго больше)', () => {
    expect(detectWorkloadOverload(120, 120)).toBe(false);
  });
  it('loadPercent < порога → false', () => {
    expect(detectWorkloadOverload(100, 120)).toBe(false);
    expect(detectWorkloadOverload(0, 120)).toBe(false);
  });
});

describe('detectMeetingNoshows (ТЗ-1 Ф3.D.3)', () => {
  it('число неявок >= порога → true (на границе)', () => {
    expect(detectMeetingNoshows(3, 3)).toBe(true);
    expect(detectMeetingNoshows(5, 3)).toBe(true);
  });
  it('число неявок < порога → false', () => {
    expect(detectMeetingNoshows(2, 3)).toBe(false);
    expect(detectMeetingNoshows(0, 3)).toBe(false);
  });
});
