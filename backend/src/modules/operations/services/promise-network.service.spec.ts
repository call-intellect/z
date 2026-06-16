import { describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { PromiseNetworkService } from './promise-network.service';

/**
 * ТЗ coo-orphan-agents Ф7 — unit-тесты PromiseNetworkService.
 *
 * Mock prisma.promiseNetworkSnapshot.findFirst, без БД. Покрываем:
 *   1. нет снапшота → hasData=false, пустые accumulators.
 *   2. валидный graphJson (2 accumulator + 1 donor) → только accumulators,
 *      отсортированы по inDegree DESC.
 *   3. битый graphJson → hasData=false, accumulators=[] (НЕ падение).
 *   4. snapshotAt + totalCommitments проброшены.
 */
describe('PromiseNetworkService', () => {
  function build(snap: unknown) {
    const prisma = {
      promiseNetworkSnapshot: {
        findFirst: vi.fn(async () => snap),
      },
    } as unknown as PrismaService;
    return new PromiseNetworkService(prisma);
  }

  it('нет снапшота → hasData=false, пустые accumulators', async () => {
    const svc = build(null);
    const out = await svc.getLatest({ tenantId: 't1' });
    expect(out).toEqual({
      hasData: false,
      snapshotAt: null,
      totalCommitments: 0,
      accumulators: [],
    });
  });

  it('валидный graphJson: только accumulators, sort inDegree DESC; snapshotAt+totalCommitments проброшены', async () => {
    const snapshotAt = new Date('2026-06-15T05:00:00.000Z');
    const svc = build({
      snapshotAt,
      totalCommitments: 42,
      graphJson: {
        nodes: [
          {
            personId: 'p1',
            name: 'Анна',
            role: 'accumulator',
            inDegree: 4,
            outDegree: 1,
            balance: 3,
          },
          {
            personId: 'p2',
            name: 'Борис',
            role: 'accumulator',
            inDegree: 9,
            outDegree: 2,
            balance: 7,
          },
          {
            personId: 'p3',
            name: 'Вера',
            role: 'donor',
            inDegree: 0,
            outDegree: 5,
            balance: -5,
          },
        ],
        edges: [],
        periodStart: '2026-06-08T00:00:00.000Z',
        periodEnd: '2026-06-15T00:00:00.000Z',
      },
    });

    const out = await svc.getLatest({ tenantId: 't1' });

    expect(out.hasData).toBe(true);
    expect(out.snapshotAt).toBe(snapshotAt.toISOString());
    expect(out.totalCommitments).toBe(42);
    // Только accumulators (donor отфильтрован), отсортированы по inDegree DESC.
    expect(out.accumulators.map((n) => n.personId)).toEqual(['p2', 'p1']);
    expect(out.accumulators[0]).toEqual({
      personId: 'p2',
      name: 'Борис',
      inDegree: 9,
      outDegree: 2,
      balance: 7,
    });
  });

  it('битый graphJson (nodes не массив) → hasData=false, accumulators=[], но snapshotAt/total проброшены', async () => {
    const snapshotAt = new Date('2026-06-15T05:00:00.000Z');
    const svc = build({
      snapshotAt,
      totalCommitments: 7,
      graphJson: { nodes: 'oops' },
    });

    const out = await svc.getLatest({ tenantId: 't1' });

    expect(out.hasData).toBe(false);
    expect(out.accumulators).toEqual([]);
    expect(out.snapshotAt).toBe(snapshotAt.toISOString());
    expect(out.totalCommitments).toBe(7);
  });

  it('битый graphJson (пустой объект без nodes) → hasData=false, accumulators=[]', async () => {
    const snapshotAt = new Date('2026-06-15T05:00:00.000Z');
    const svc = build({ snapshotAt, totalCommitments: 0, graphJson: {} });

    const out = await svc.getLatest({ tenantId: 't1' });

    expect(out.hasData).toBe(false);
    expect(out.accumulators).toEqual([]);
  });
});
