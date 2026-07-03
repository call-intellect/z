import { describe, expect, it, vi } from 'vitest';

import { backfillClientToCustomer } from './backfill-client-to-customer';

type FakePrisma = Parameters<typeof backfillClientToCustomer>[0];

function makePrisma(clientCount: { value: number }) {
  const count = vi.fn(async () => clientCount.value);
  const updateMany = vi.fn(async () => {
    const affected = clientCount.value;
    clientCount.value = 0;
    return { count: affected };
  });
  return {
    prisma: { entity: { count, updateMany } } as unknown as FakePrisma,
    count,
    updateMany,
  };
}

describe('backfill-client-to-customer', () => {
  it('первый прогон обновляет всех client→customer, второй прогон = 0 (идемпотентность)', async () => {
    const state = { value: 7 };
    const { prisma, updateMany } = makePrisma(state);

    const first = await backfillClientToCustomer(prisma, { dryRun: false });
    expect(first.updated).toBe(7);

    const second = await backfillClientToCustomer(prisma, { dryRun: false });
    expect(second.scanned).toBe(0);
    expect(second.updated).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('--dry-run считает, но не пишет', async () => {
    const state = { value: 3 };
    const { prisma, updateMany } = makePrisma(state);

    const res = await backfillClientToCustomer(prisma, { dryRun: true });

    expect(res.scanned).toBe(3);
    expect(res.updated).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
