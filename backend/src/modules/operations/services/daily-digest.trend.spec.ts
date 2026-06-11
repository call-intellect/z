import { describe, expect, it } from 'vitest';

import { mapDailyDigestRowsToTrend } from './daily-digest.service';

/**
 * Ф1b редизайна дашбордов — чистый маппер persisted-снимков daily-дайджеста
 * в трендовые точки (`mapDailyDigestRowsToTrend`).
 *
 * Тестируем БЕЗ моков prisma: на вход — массив строк в порядке DESC по
 * `dateLocal` (как их отдаёт `findMany orderBy desc`), на выход — массив
 * точек в порядке old→new с корректно извлечёнными значениями.
 *
 * Контракт metricsJson (daily, verified): totalCheckIns / greenShare /
 * redShare / newBlockers[] / overdueCommitments[] / goals.{completed,failed}.
 */

describe('mapDailyDigestRowsToTrend', () => {
  it('переворачивает DESC→old→new и извлекает значения по контракту', () => {
    // DESC-порядок: d (новейший), d-1, d-2.
    const rowsDesc = [
      {
        dateLocal: '2026-06-03',
        metricsJson: {
          totalCheckIns: 12,
          greenShare: 0.75,
          redShare: 0.1,
          newBlockers: [{ blockId: 'b1' }, { blockId: 'b2' }, { blockId: 'b3' }],
          overdueCommitments: [{ blockId: 'c1' }],
          goals: { completed: 4, failed: 1 },
        },
      },
      {
        dateLocal: '2026-06-02',
        metricsJson: {
          totalCheckIns: 8,
          greenShare: 0.5,
          redShare: 0.25,
          newBlockers: [{ blockId: 'b4' }],
          overdueCommitments: [{ blockId: 'c2' }, { blockId: 'c3' }],
          goals: { completed: 2, failed: 0 },
        },
      },
      {
        dateLocal: '2026-06-01',
        metricsJson: {
          totalCheckIns: 5,
          greenShare: 0.2,
          redShare: 0.6,
          newBlockers: [],
          overdueCommitments: [],
          goals: { completed: 0, failed: 3 },
        },
      },
    ];

    const trend = mapDailyDigestRowsToTrend(rowsDesc);

    // Длина сохранена, порядок развёрнут в old→new.
    expect(trend).toHaveLength(3);
    expect(trend.map((p) => p.dateLocal)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);

    // Старейшая точка (d-2).
    expect(trend[0]).toEqual({
      dateLocal: '2026-06-01',
      totalCheckIns: 5,
      greenShare: 0.2,
      redShare: 0.6,
      blockers: 0, // newBlockers.length
      overdueCommitments: 0, // overdueCommitments.length
      goalsCompleted: 0,
      goalsFailed: 3,
    });

    // Новейшая точка (d): blockers = newBlockers.length = 3,
    // overdueCommitments = 1, goalsCompleted = goals.completed = 4.
    expect(trend[2]).toEqual({
      dateLocal: '2026-06-03',
      totalCheckIns: 12,
      greenShare: 0.75,
      redShare: 0.1,
      blockers: 3,
      overdueCommitments: 1,
      goalsCompleted: 4,
      goalsFailed: 1,
    });

    // Средняя точка (d-1).
    expect(trend[1]!.blockers).toBe(1);
    expect(trend[1]!.overdueCommitments).toBe(2);
    expect(trend[1]!.goalsCompleted).toBe(2);
  });

  it('пустой вход → пустой массив', () => {
    expect(mapDailyDigestRowsToTrend([])).toEqual([]);
  });

  it('граничный: metricsJson = {} или null → точка со всеми 0 (не падает)', () => {
    const trend = mapDailyDigestRowsToTrend([
      { dateLocal: '2026-06-02', metricsJson: {} },
      { dateLocal: '2026-06-01', metricsJson: null },
    ]);

    expect(trend).toHaveLength(2);
    // После reverse: [ (2026-06-01, null), (2026-06-02, {}) ].
    expect(trend[0]).toEqual({
      dateLocal: '2026-06-01',
      totalCheckIns: 0,
      greenShare: 0,
      redShare: 0,
      blockers: 0,
      overdueCommitments: 0,
      goalsCompleted: 0,
      goalsFailed: 0,
    });
    expect(trend[1]!.dateLocal).toBe('2026-06-02');
    expect(trend[1]!.totalCheckIns).toBe(0);
    expect(trend[1]!.blockers).toBe(0);
    expect(trend[1]!.goalsCompleted).toBe(0);
  });
});
