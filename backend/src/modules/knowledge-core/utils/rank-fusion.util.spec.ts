import { describe, expect, it } from 'vitest';

import { fuseRankedLists, reciprocalRankFusion } from './rank-fusion.util';

describe('rank-fusion (RRF)', () => {
  it('блок, высоко ранжированный в двух списках, побеждает', () => {
    const a = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const b = [{ id: 'y' }, { id: 'x' }, { id: 'w' }];
    const fused = fuseRankedLists([a, b]);
    expect(fused[0] === 'x' || fused[0] === 'y').toBe(true);
    expect(fused).toContain('z');
    expect(fused).toContain('w');
  });

  it('RRF-вклад = 1/(k+rank+1), ранг 0 даёт больший вклад', () => {
    const scores = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }]], 60);
    expect(scores.get('a')!).toBeCloseTo(1 / 61, 10);
    expect(scores.get('b')!).toBeCloseTo(1 / 62, 10);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!);
  });

  it('меняет порядок относительно одиночного списка при слиянии нескольких подзапросов', () => {
    const q1 = [{ id: 'top1' }, { id: 'mid' }];
    const q2 = [{ id: 'mid' }, { id: 'top1' }];
    const q3 = [{ id: 'mid' }, { id: 'other' }];
    const fused = fuseRankedLists([q1, q2, q3]);
    expect(fused[0]).toBe('mid');
  });

  it('пустые списки → пустой результат', () => {
    expect(fuseRankedLists([])).toEqual([]);
    expect(fuseRankedLists([[]])).toEqual([]);
  });
});
