import { describe, expect, it } from 'vitest';

import { dedupBriefItems, type BriefItem } from './personal-daily-brief.synth';

describe('personal-daily-brief.synth', () => {
  const item = (over: Partial<BriefItem>): BriefItem => ({
    kind: over.kind ?? 'task',
    dedupKey: over.dedupKey ?? 'k1',
    title: over.title ?? 'title',
    dueDateIso: over.dueDateIso ?? null,
    overdue: over.overdue ?? false,
    priority: over.priority,
    counterpartyName: over.counterpartyName,
  });

  describe('dedupBriefItems', () => {
    it('одинаковый (kind, dedupKey) схлопывается в один пункт', () => {
      const out = dedupBriefItems([
        item({ dedupKey: 'a', title: 'first' }),
        item({ dedupKey: 'a', title: 'second' }),
      ]);
      expect(out).toHaveLength(1);
    });

    it('при коллизии остаётся пункт с меньшим priority (важнее)', () => {
      const out = dedupBriefItems([
        item({ dedupKey: 'a', title: 'low-prio', priority: 100 }),
        item({ dedupKey: 'a', title: 'high-prio', priority: 10 }),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]!.title).toBe('high-prio');
    });

    it('сохраняет позицию первого встреченного ключа', () => {
      const out = dedupBriefItems([
        item({ dedupKey: 'a', title: 'A', priority: 100 }),
        item({ dedupKey: 'b', title: 'B' }),
        item({ dedupKey: 'a', title: 'A-better', priority: 1 }),
      ]);
      expect(out.map((i) => i.title)).toEqual(['A-better', 'B']);
    });

    it('разные kind с одинаковым dedupKey НЕ схлопываются внутри dedupBriefItems', () => {
      const out = dedupBriefItems([
        item({ kind: 'task', dedupKey: 'a' }),
        item({ kind: 'blocker', dedupKey: 'a' }),
      ]);
      expect(out).toHaveLength(2);
    });

    it('пункты без dedupKey не дедупаются (каждый уникален)', () => {
      const out = dedupBriefItems([
        item({ dedupKey: '', title: 'one' }),
        item({ dedupKey: '', title: 'two' }),
      ]);
      expect(out).toHaveLength(2);
    });
  });
});
