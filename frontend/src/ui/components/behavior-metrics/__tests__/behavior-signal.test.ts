import { describe, expect, it } from 'vitest';

import type { BehaviorMetricsDomain } from '@/domain/behavior-metrics';

import { hasBehaviorSignal } from '../MeetingBehaviorSection';

describe('hasBehaviorSignal', () => {
  it('meeting === null → false', () => {
    const data = { meeting: null, participants: [] } as unknown as BehaviorMetricsDomain;
    expect(hasBehaviorSignal(data)).toBe(false);
  });

  it('нулевая речь и все участники без говорения → false', () => {
    const data = {
      meeting: { totalSpeechMs: 0 },
      participants: [{ speakingTimeMs: 0 }, { speakingTimeMs: 0 }],
    } as unknown as BehaviorMetricsDomain;
    expect(hasBehaviorSignal(data)).toBe(false);
  });

  it('есть участник с говорением → true', () => {
    const data = {
      meeting: { totalSpeechMs: 0 },
      participants: [{ speakingTimeMs: 0 }, { speakingTimeMs: 1200 }],
    } as unknown as BehaviorMetricsDomain;
    expect(hasBehaviorSignal(data)).toBe(true);
  });

  it('есть суммарная речь встречи → true', () => {
    const data = {
      meeting: { totalSpeechMs: 48000 },
      participants: [],
    } as unknown as BehaviorMetricsDomain;
    expect(hasBehaviorSignal(data)).toBe(true);
  });
});
