/**
 * ТЗ coo-orphan-agents Ф7 — тесты domain «перегруз ответственностью».
 */
import { describe, expect, it } from 'vitest';

import type { PromiseNetworkApi } from '@/api/operations-dashboard.api';

import { fromPromiseNetworkApi } from './promise-network';

describe('fromPromiseNetworkApi', () => {
  it('snapshotAt=null → null; флаги hasData/totalCommitments проброшены; accumulators пусты', () => {
    const api: PromiseNetworkApi = {
      hasData: false,
      snapshotAt: null,
      totalCommitments: 0,
      accumulators: [],
    };

    const out = fromPromiseNetworkApi(api);

    expect(out.hasData).toBe(false);
    expect(out.snapshotAt).toBeNull();
    expect(out.totalCommitments).toBe(0);
    expect(out.accumulators).toEqual([]);
  });

  it('ISO snapshotAt → Date; accumulators и totalCommitments проброшены', () => {
    const api: PromiseNetworkApi = {
      hasData: true,
      snapshotAt: '2026-06-15T05:00:00.000Z',
      totalCommitments: 42,
      accumulators: [
        {
          personId: 'p1',
          name: 'Анна',
          inDegree: 9,
          outDegree: 2,
          balance: 7,
        },
      ],
    };

    const out = fromPromiseNetworkApi(api);

    expect(out.hasData).toBe(true);
    expect(out.snapshotAt).toBeInstanceOf(Date);
    expect(out.snapshotAt?.toISOString()).toBe('2026-06-15T05:00:00.000Z');
    expect(out.totalCommitments).toBe(42);
    expect(out.accumulators).toHaveLength(1);
    expect(out.accumulators[0]).toEqual({
      personId: 'p1',
      name: 'Анна',
      inDegree: 9,
      outDegree: 2,
      balance: 7,
    });
  });
});
