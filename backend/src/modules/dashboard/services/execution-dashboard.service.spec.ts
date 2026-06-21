import { describe, expect, it } from 'vitest';

import {
  buildGoalVectorRows,
  computeDeltas,
  directionFromNet,
  type GoalVectorPersonAggregate,
} from './execution-dashboard.service';

describe('directionFromNet', () => {
  it('net > 0.5 → up', () => {
    expect(directionFromNet(1.2)).toBe('up');
    expect(directionFromNet(0.51)).toBe('up');
  });

  it('net < -0.5 → down', () => {
    expect(directionFromNet(-0.9)).toBe('down');
    expect(directionFromNet(-0.51)).toBe('down');
  });

  it('|net| <= 0.5 → side', () => {
    expect(directionFromNet(0)).toBe('side');
    expect(directionFromNet(0.5)).toBe('side');
    expect(directionFromNet(-0.5)).toBe('side');
  });
});

describe('buildGoalVectorRows', () => {
  it('три человека с net +1.2 / 0.0 / -0.9 → up/side/down и сортировка по netScore desc', () => {
    const people: GoalVectorPersonAggregate[] = [
      {
        personId: 'p-side',
        personName: 'Сайдов',
        netScore: 0,
        proScore: 1,
        contraScore: 1,
        tasksDone: 1,
        tasksOpen: 2,
      },
      {
        personId: 'p-down',
        personName: 'Даунов',
        netScore: -0.9,
        proScore: 0.1,
        contraScore: 1,
        tasksDone: 0,
        tasksOpen: 3,
      },
      {
        personId: 'p-up',
        personName: 'Апов',
        netScore: 1.2,
        proScore: 1.2,
        contraScore: 0,
        tasksDone: 4,
        tasksOpen: 1,
      },
    ];

    const rows = buildGoalVectorRows(people);

    expect(rows.map((r) => r.personId)).toEqual(['p-up', 'p-side', 'p-down']);
    expect(rows.map((r) => r.direction)).toEqual(['up', 'side', 'down']);
    expect(rows[0]!.netScore).toBe(1.2);
    expect(rows[2]!.netScore).toBe(-0.9);
  });

  it('пустой вход → пустой массив', () => {
    expect(buildGoalVectorRows([])).toEqual([]);
  });
});

describe('computeDeltas', () => {
  it('оба периода есть → дельты числовых ключей', () => {
    const current = { greenShare: 0.75, redShare: 0.1, totalCheckIns: 12 };
    const previous = { greenShare: 0.5, redShare: 0.25, totalCheckIns: 8 };
    const deltas = computeDeltas(current, previous);
    expect(deltas.greenShare).toBeCloseTo(0.25);
    expect(deltas.redShare).toBeCloseTo(-0.15);
    expect(deltas.totalCheckIns).toBe(4);
  });

  it('previous = null → пустые дельты', () => {
    expect(computeDeltas({ greenShare: 0.75 }, null)).toEqual({});
  });

  it('current = null → пустые дельты', () => {
    expect(computeDeltas(null, { greenShare: 0.5 })).toEqual({});
  });

  it('ключ только в current → пропущен; нечисловой → пропущен', () => {
    const current = { greenShare: 0.75, topBlockers: ['a', 'b'], onlyHere: 3 };
    const previous = { greenShare: 0.5, topBlockers: ['c'] };
    const deltas = computeDeltas(current, previous);
    expect(Object.keys(deltas)).toEqual(['greenShare']);
    expect(deltas.greenShare).toBeCloseTo(0.25);
  });
});
