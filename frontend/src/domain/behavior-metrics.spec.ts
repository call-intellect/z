import { describe, expect, it } from 'vitest';

import {
  isDiarizationDegenerate,
  type BehaviorMeetingMetricsDomain,
} from './behavior-metrics';

function meeting(
  over: Partial<BehaviorMeetingMetricsDomain>,
): BehaviorMeetingMetricsDomain {
  return {
    totalDurationMs: 44 * 60_000,
    totalSpeechMs: 40 * 60_000,
    silenceMs: 0,
    silencePercent: 0,
    crossTalkMs: 0,
    dominanceIndex: 0,
    lowConfidence: false,
    diarizationConfidence: 1,
    computedAt: new Date(0),
    ...over,
  };
}

describe('isDiarizationDegenerate (#26)', () => {
  it('вырожденная: lowConfidence + речь 130 мин при встрече 44 мин → true', () => {
    expect(
      isDiarizationDegenerate(
        meeting({
          lowConfidence: true,
          totalDurationMs: 44 * 60_000,
          totalSpeechMs: 130 * 60_000,
          crossTalkMs: 128 * 60_000,
        }),
      ),
    ).toBe(true);
  });

  it('нормальная (lowConfidence=false) → false даже если речь чуть больше', () => {
    expect(
      isDiarizationDegenerate(
        meeting({ lowConfidence: false, totalSpeechMs: 130 * 60_000 }),
      ),
    ).toBe(false);
  });

  it('lowConfidence, но речь в пределах длительности → НЕ вырожденная', () => {
    expect(
      isDiarizationDegenerate(
        meeting({ lowConfidence: true, totalSpeechMs: 40 * 60_000 }),
      ),
    ).toBe(false);
  });

  it('нулевая длительность → false', () => {
    expect(
      isDiarizationDegenerate(
        meeting({ lowConfidence: true, totalDurationMs: 0, totalSpeechMs: 5 }),
      ),
    ).toBe(false);
  });

  it('null → false', () => {
    expect(isDiarizationDegenerate(null)).toBe(false);
  });
});
