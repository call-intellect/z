import { describe, expect, it } from 'vitest';

import { segmentMessages } from './chatbox-session.service';

const H = 60 * 60 * 1000;

function at(hoursFromBase: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + hoursFromBase * H);
}

describe('segmentMessages', () => {
  it('пустой вход → []', () => {
    expect(segmentMessages([], 12, true)).toEqual([]);
  });

  it('сообщения без больших пауз, активный чат → 1 сегмент, endedAt=null', () => {
    const msgs = [
      { id: 'm1', at: at(0) },
      { id: 'm2', at: at(1) },
      { id: 'm3', at: at(2) },
    ];
    const segs = segmentMessages(msgs, 12, true);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.messageIds).toEqual(['m1', 'm2', 'm3']);
    expect(segs[0]!.startedAt).toEqual(at(0));
    expect(segs[0]!.endedAt).toBeNull();
  });

  it('пауза > idleGap, закрытый чат → 2 сегмента, оба закрыты по последнему сообщению', () => {
    const msgs = [
      { id: 'm1', at: at(0) },
      { id: 'm2', at: at(1) },
      { id: 'm3', at: at(20) },
      { id: 'm4', at: at(21) },
    ];
    const segs = segmentMessages(msgs, 12, false);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.messageIds).toEqual(['m1', 'm2']);
    expect(segs[0]!.endedAt).toEqual(at(1));
    expect(segs[1]!.messageIds).toEqual(['m3', 'm4']);
    expect(segs[1]!.endedAt).toEqual(at(21));
  });

  it('пауза ровно = idleGap (не >) → один сегмент', () => {
    const msgs = [
      { id: 'm1', at: at(0) },
      { id: 'm2', at: at(12) },
    ];
    const segs = segmentMessages(msgs, 12, false);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.messageIds).toEqual(['m1', 'm2']);
    expect(segs[0]!.endedAt).toEqual(at(12));
  });
});
