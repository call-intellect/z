import { describe, expect, it } from 'vitest';

import { mapWeeklyDigestRowsToTrend } from './weekly-digest.service';

/**
 * Ф1b редизайна дашбордов — чистый маппер persisted-снимков weekly-дайджеста
 * в трендовые точки (`mapWeeklyDigestRowsToTrend`).
 *
 * Тестируем БЕЗ моков prisma: на вход — массив строк в порядке DESC по
 * `weekStart`, на выход — массив точек в порядке old→new.
 *
 * Контракт metricsJson (weekly, verified): totalCheckIns / greenShare /
 * redShare / topBlockers[{text,count}] / hangingDecisions[] /
 * goals.{completed,failed}. blockers = sum(topBlockers[].count),
 * hangingDecisions = hangingDecisions.length.
 */

describe('mapWeeklyDigestRowsToTrend', () => {
  it('переворачивает DESC→old→new; blockers=sum(count), hangingDecisions=length', () => {
    // DESC-порядок: w (новейшая), w-1, w-2.
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
          hangingDecisions: [
            { decisionId: 'd1', statement: 's1', ageDays: 10 },
            { decisionId: 'd2', statement: 's2', ageDays: 3 },
            { decisionId: 'd3', statement: 's3', ageDays: 1 },
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
          hangingDecisions: [{ decisionId: 'd4', statement: 's4', ageDays: 7 }],
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
          hangingDecisions: [],
          goals: { completed: 0, failed: 4 },
        },
      },
    ];

    const trend = mapWeeklyDigestRowsToTrend(rowsDesc);

    expect(trend).toHaveLength(3);
    expect(trend.map((p) => p.weekStart)).toEqual([
      '2026-05-11',
      '2026-05-18',
      '2026-05-25',
    ]);

    // Старейшая точка (w-2).
    expect(trend[0]).toEqual({
      weekStart: '2026-05-11',
      totalCheckIns: 10,
      greenShare: 0.2,
      redShare: 0.5,
      goalsCompleted: 0,
      goalsFailed: 4,
      blockers: 0, // sum(topBlockers[].count) на пустом массиве
      hangingDecisions: 0,
    });

    // Новейшая точка (w): blockers = 5 + 2 = 7, hangingDecisions = 3.
    expect(trend[2]).toEqual({
      weekStart: '2026-05-25',
      totalCheckIns: 30,
      greenShare: 0.7,
      redShare: 0.1,
      goalsCompleted: 6,
      goalsFailed: 1,
      blockers: 7,
      hangingDecisions: 3,
    });

    // Средняя точка (w-1).
    expect(trend[1]!.blockers).toBe(4);
    expect(trend[1]!.hangingDecisions).toBe(1);
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
    // После reverse: [ (2026-05-11, null), (2026-05-18, {}) ].
    expect(trend[0]).toEqual({
      weekStart: '2026-05-11',
      totalCheckIns: 0,
      greenShare: 0,
      redShare: 0,
      goalsCompleted: 0,
      goalsFailed: 0,
      blockers: 0,
      hangingDecisions: 0,
    });
    expect(trend[1]!.weekStart).toBe('2026-05-18');
    expect(trend[1]!.blockers).toBe(0);
    expect(trend[1]!.hangingDecisions).toBe(0);
  });

  it('topBlockers с битым count → 0 в сумме (Number||0)', () => {
    const trend = mapWeeklyDigestRowsToTrend([
      {
        weekStart: '2026-05-11',
        metricsJson: {
          topBlockers: [
            { text: 'a', count: 3 },
            { text: 'b' }, // count отсутствует
            { text: 'c', count: 'xx' }, // не число
          ],
        },
      },
    ]);
    expect(trend[0]!.blockers).toBe(3);
  });
});
