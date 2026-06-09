import { describe, expect, it } from 'vitest';

import {
  dedupBriefItems,
  dropPromisesThatBecameTasks,
  type BriefItem,
} from './personal-daily-brief.synth';

/**
 * TZ-1 Фаза 2 (daily-value-engine) — unit-тесты дедупа персонального брифа.
 * Без БД/времени. Главный кейс — обещание, ставшее задачей, считается один раз.
 */
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
        item({ kind: 'my_promise', dedupKey: 'a' }),
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

  describe('dropPromisesThatBecameTasks', () => {
    it('обещание, ставшее задачей (общий dedupKey), считается ОДИН раз (как задача)', () => {
      const tasks = [item({ kind: 'task', dedupKey: 'block-1', title: 'Задача из обещания' })];
      const promises = [
        item({ kind: 'my_promise', dedupKey: 'block-1', title: 'Обещание-источник' }),
        item({ kind: 'my_promise', dedupKey: 'block-2', title: 'Другое обещание' }),
      ];
      const out = dropPromisesThatBecameTasks({ tasks, promises });
      // block-1 ушло (стало задачей), block-2 осталось
      expect(out.map((p) => p.dedupKey)).toEqual(['block-2']);
    });

    it('без пересечений ключей — обещания не трогаются', () => {
      const tasks = [item({ kind: 'task', dedupKey: 't1' })];
      const promises = [item({ kind: 'my_promise', dedupKey: 'p1' })];
      const out = dropPromisesThatBecameTasks({ tasks, promises });
      expect(out).toHaveLength(1);
    });

    it('пустые задачи — все обещания остаются', () => {
      const promises = [item({ kind: 'my_promise', dedupKey: 'p1' })];
      expect(dropPromisesThatBecameTasks({ tasks: [], promises })).toEqual(promises);
    });
  });
});
