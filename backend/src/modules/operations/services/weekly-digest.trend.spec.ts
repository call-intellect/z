import { describe, expect, it } from 'vitest';

import { mapWeeklyDigestRowsToTrend } from './weekly-digest.service';

describe('mapWeeklyDigestRowsToTrend', () => {
  it('переворачивает DESC→old→new; blockers=sum(count)', () => {
    const rowsDesc = [
      {
        weekStart: '2026-05-25',
        metricsJson: {
          totalCheckIns: 30,
          greenShare: 0.7,
          redShare: 0.1,
          topBlockers: [
            { text: 'нет ресурсов', count: 5 },
            { text: 'ждём клиента', count: 2 },
          ],
          goals: { completed: 6, failed: 1 },
        },
      },
      {
        weekStart: '2026-05-18',
        metricsJson: {
          totalCheckIns: 22,
          greenShare: 0.4,
          redShare: 0.3,
          topBlockers: [{ text: 'блок', count: 4 }],
          goals: { completed: 3, failed: 2 },
        },
      },
      {
        weekStart: '2026-05-11',
        metricsJson: {
          totalCheckIns: 10,
          greenShare: 0.2,
          redShare: 0.5,
          topBlockers: [],
          goals: { completed: 0, failed: 4 },
        },
      },
    ];

    const trend = mapWeeklyDigestRowsToTrend(rowsDesc);

    expect(trend).toHaveLength(3);
    expect(trend.map((p) => p.weekStart)).toEqual(['2026-05-11', '2026-05-18', '2026-05-25']);

    expect(trend[0]).toEqual({
      weekStart: '2026-05-11',
      totalCheckIns: 10,
      greenShare: 0.2,
      redShare: 0.5,
      goalsCompleted: 0,
      goalsFailed: 4,
      blockers: 0,
    });

    expect(trend[2]).toEqual({
      weekStart: '2026-05-25',
      totalCheckIns: 30,
      greenShare: 0.7,
      redShare: 0.1,
      goalsCompleted: 6,
      goalsFailed: 1,
      blockers: 7,
    });

    expect(trend[1]!.blockers).toBe(4);
    expect(trend[1]!.goalsCompleted).toBe(3);
    expect(trend[1]!.goalsFailed).toBe(2);
  });

  it('пустой вход → пустой массив', () => {
    expect(mapWeeklyDigestRowsToTrend([])).toEqual([]);
  });

  it('граничный: metricsJson = {} или null → точка со всеми 0 (не падает)', () => {
    const trend = mapWeeklyDigestRowsToTrend([
      { weekStart: '2026-05-18', metricsJson: {} },
      { weekStart: '2026-05-11', metricsJson: null },
    ]);

    expect(trend).toHaveLength(2);
    expect(trend[0]).toEqual({
      weekStart: '2026-05-11',
      totalCheckIns: 0,
      greenShare: 0,
      redShare: 0,
      goalsCompleted: 0,
      goalsFailed: 0,
      blockers: 0,
    });
    expect(trend[1]!.weekStart).toBe('2026-05-18');
    expect(trend[1]!.blockers).toBe(0);
  });

  it('topBlockers с битым count → 0 в сумме (Number||0)', () => {
    const trend = mapWeeklyDigestRowsToTrend([
      {
        weekStart: '2026-05-11',
        metricsJson: {
          topBlockers: [{ text: 'a', count: 3 }, { text: 'b' }, { text: 'c', count: 'xx' }],
        },
      },
    ]);
    expect(trend[0]!.blockers).toBe(3);
  });
});
