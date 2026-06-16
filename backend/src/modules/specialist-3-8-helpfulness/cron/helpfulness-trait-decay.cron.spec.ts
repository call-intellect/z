import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HelpfulnessTraitDecayCron } from './helpfulness-trait-decay.cron';

describe('HelpfulnessTraitDecayCron', () => {
  const updateManyMock = vi.fn(async (_args: unknown) => ({ count: 0 }));
  const mockPrisma = {
    helpfulnessTrait: {
      updateMany: updateManyMock,
    },
  } as unknown as ConstructorParameters<typeof HelpfulnessTraitDecayCron>[0];
  const incMock = vi.fn();
  const mockMetrics = {
    incCoreSpecialistCards: incMock,
  } as unknown as ConstructorParameters<typeof HelpfulnessTraitDecayCron>[1];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  interface UpdateManyArgs {
    where: { status: string; lastObservedAt: { lt: Date } };
    data: { status: string; decayedAt: Date };
  }

  it('updateMany WHERE: status=active AND lastObservedAt < (now - 30d)', async () => {
    const cron = new HelpfulnessTraitDecayCron(mockPrisma, mockMetrics);
    const before = Date.now();
    await cron.runOnce();
    const after = Date.now();

    expect(updateManyMock).toHaveBeenCalledOnce();
    const args = updateManyMock.mock.calls[0]?.[0] as undefined | UpdateManyArgs;
    expect(args).toBeDefined();
    expect(args!.where.status).toBe('active');
    expect(args!.where.lastObservedAt.lt).toBeInstanceOf(Date);

    const threshold = args!.where.lastObservedAt.lt;
    const expectedMin = before - 30 * 86400 * 1000;
    const expectedMax = after - 30 * 86400 * 1000;
    expect(threshold.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(threshold.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('обновляет status=decayed и проставляет decayedAt=now', async () => {
    const cron = new HelpfulnessTraitDecayCron(mockPrisma, mockMetrics);
    await cron.runOnce();
    const args = updateManyMock.mock.calls[0]?.[0] as undefined | UpdateManyArgs;
    expect(args!.data.status).toBe('decayed');
    expect(args!.data.decayedAt).toBeInstanceOf(Date);
  });

  it('инкрементирует метрику только если updateMany вернул > 0', async () => {
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const cron = new HelpfulnessTraitDecayCron(mockPrisma, mockMetrics);
    await cron.runOnce();
    expect(incMock).not.toHaveBeenCalled();

    updateManyMock.mockResolvedValueOnce({ count: 5 });
    await cron.runOnce();
    expect(incMock).toHaveBeenCalledOnce();
  });

  it('возвращает count из updateMany', async () => {
    updateManyMock.mockResolvedValueOnce({ count: 42 });
    const cron = new HelpfulnessTraitDecayCron(mockPrisma, mockMetrics);
    const res = await cron.runOnce();
    expect(res.decayedCount).toBe(42);
  });
});
