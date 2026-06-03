import { describe, expect, it } from 'vitest';

import { deriveTraceFromJob, traceForMeeting } from './log-pipeline';

describe('deriveTraceFromJob', () => {
  it('наивысший приоритет — явный data.traceId (проброс цепочки)', () => {
    expect(
      deriveTraceFromJob({ id: 'j1', data: { traceId: 'mtg_M1', blockId: 'B1' } }),
    ).toBe('mtg_M1');
  });

  it('meetingId → mtg_<id> (совпадает с traceForMeeting)', () => {
    expect(deriveTraceFromJob({ data: { meetingId: 'M1' } })).toBe(traceForMeeting('M1'));
  });

  it('приоритет полей: blockId раньше tenantId', () => {
    expect(deriveTraceFromJob({ data: { blockId: 'B1', tenantId: 'T1' } })).toBe('block_B1');
  });

  it('нет якорных полей → фолбэк job_<id>', () => {
    expect(deriveTraceFromJob({ id: 42, data: {} })).toBe('job_42');
  });

  it('пустой data и нет id → undefined', () => {
    expect(deriveTraceFromJob({ data: {} })).toBeUndefined();
  });

  it('пустая строка traceId не считается (идём дальше по полям)', () => {
    expect(deriveTraceFromJob({ data: { traceId: '', cardId: 'C1' } })).toBe('card_C1');
  });
});
