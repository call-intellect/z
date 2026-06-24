import { describe, expect, it } from 'vitest';

import { SegmentBuilderService } from './segment-builder.service';

function buildService(opts: {
  segmentMaxTokens: number;
  segmentOverlapRatio: number;
  ceiling?: number;
}): SegmentBuilderService {
  const cfg = {
    knowledgeCore: {
      blockIngestMaxTokensPerSegment: opts.ceiling ?? 2000,
      segmentMaxTokens: opts.segmentMaxTokens,
      segmentOverlapRatio: opts.segmentOverlapRatio,
    },
  };
  return new SegmentBuilderService(cfg as never);
}

function meetingPayload(turns: Array<{ text: string }>): unknown {
  return {
    transcript: {
      turns: turns.map((t, i) => ({
        speaker: 'Аня',
        text: t.text,
        startSec: i,
        endSec: i + 1,
      })),
    },
  };
}

describe('SegmentBuilderService overlap нарезки', () => {
  it('длинная одно-speaker реплика → ≥2 сегментов, конец N в начале N+1', () => {
    const service = buildService({ segmentMaxTokens: 40, segmentOverlapRatio: 0.3 });
    const turns = Array.from({ length: 12 }, (_v, i) => ({
      text: `реплика номер ${i} про планы спринта`,
    }));
    const segments = service.buildSegments(meetingPayload(turns));

    expect(segments.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < segments.length - 1; i++) {
      const prevLines = segments[i]!.text.split('\n');
      const nextLines = segments[i + 1]!.text.split('\n');
      const prevTail = prevLines[prevLines.length - 1]!;
      expect(nextLines).toContain(prevTail);
    }
  });

  it('overlapRatio=0 → нет повторов хвоста между сегментами', () => {
    const service = buildService({ segmentMaxTokens: 40, segmentOverlapRatio: 0 });
    const turns = Array.from({ length: 12 }, (_v, i) => ({
      text: `реплика номер ${i} про планы спринта`,
    }));
    const segments = service.buildSegments(meetingPayload(turns));
    expect(segments.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < segments.length - 1; i++) {
      const prevLines = segments[i]!.text.split('\n');
      const nextLines = segments[i + 1]!.text.split('\n');
      const prevTail = prevLines[prevLines.length - 1]!;
      expect(nextLines).not.toContain(prevTail);
    }
  });
});
