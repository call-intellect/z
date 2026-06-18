import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillGoalV2Defaults } from './backfill-goal-v2-defaults';

describe('backfillGoalV2Defaults', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let prisma: PrismaClient;

  beforeEach(() => {
    findMany = vi.fn();
    update = vi.fn().mockResolvedValue({});
    prisma = { goal: { findMany, update } } as unknown as PrismaClient;
  });

  it('apply: фиксит recordedAt у legacy-целей (recordedAt != createdAt)', async () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const recorded = new Date('2026-06-02T10:00:00.000Z');
    findMany.mockResolvedValueOnce([{ id: 'g1', createdAt: created, recordedAt: recorded }]);

    const stats = await backfillGoalV2Defaults(prisma, { apply: true });

    expect(stats.goalsScanned).toBe(1);
    expect(stats.recordedAtFixed).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { recordedAt: created },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { validUntil: null, supersededById: null },
      }),
    );
  });

  it('идемпотентность: recordedAt == createdAt → 0 fixed, без update', async () => {
    const ts = new Date('2026-01-01T00:00:00.000Z');
    findMany.mockResolvedValueOnce([{ id: 'g1', createdAt: ts, recordedAt: ts }]);

    const stats = await backfillGoalV2Defaults(prisma, { apply: true });

    expect(stats.goalsScanned).toBe(1);
    expect(stats.recordedAtFixed).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('нет кандидатов вовсе → 0 scanned, 0 fixed', async () => {
    findMany.mockResolvedValueOnce([]);

    const stats = await backfillGoalV2Defaults(prisma, { apply: true });

    expect(stats.goalsScanned).toBe(0);
    expect(stats.recordedAtFixed).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('dry-run: считает кандидата, но не пишет', async () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const recorded = new Date('2026-06-02T10:00:00.000Z');
    findMany.mockResolvedValueOnce([{ id: 'g1', createdAt: created, recordedAt: recorded }]);

    const stats = await backfillGoalV2Defaults(prisma, { apply: false });

    expect(stats.recordedAtFixed).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});
