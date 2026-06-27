import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { ProbeDialogTtlCron } from './probe-dialog-ttl.cron';

interface Mocks {
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
  incProbeDialogTransition: ReturnType<typeof vi.fn>;
  incProbeDialogOutcome: ReturnType<typeof vi.fn>;
  cron: ProbeDialogTtlCron;
}

function makeMocks(): Mocks {
  const findMany = vi.fn();
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const getDynamic = vi.fn().mockResolvedValue(48);
  const incProbeDialogTransition = vi.fn();
  const incProbeDialogOutcome = vi.fn();

  const prisma = {
    probeDialogState: { findMany, update },
    probeEvent: { updateMany },
  } as unknown as PrismaService;
  const cfg = { getDynamic } as unknown as TypedConfigService;
  const metrics = {
    incProbeDialogTransition,
    incProbeDialogOutcome,
  } as unknown as BusinessMetricsService;

  const cron = new ProbeDialogTtlCron(prisma, cfg, metrics);

  return {
    findMany,
    update,
    updateMany,
    getDynamic,
    incProbeDialogTransition,
    incProbeDialogOutcome,
    cron,
  };
}

describe('ProbeDialogTtlCron', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('stale awaiting_confirmation → resolved + probeEvent.abandoned + outcome=abandoned', async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: 'pds-1', probeEventId: 'pe-1', phase: 'awaiting_confirmation', tenantId: 't1' },
    ]);

    await mocks.cron.sweep();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const updateArg = mocks.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { phase: string };
    };
    expect(updateArg.where.id).toBe('pds-1');
    expect(updateArg.data.phase).toBe('resolved');

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const updateManyArg = mocks.updateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string };
      data: { status: string };
    };
    expect(updateManyArg.where).toMatchObject({ id: 'pe-1', tenantId: 't1' });
    expect(updateManyArg.data.status).toBe('abandoned');

    expect(mocks.incProbeDialogOutcome).toHaveBeenCalledWith({ outcome: 'abandoned' });
    expect(mocks.incProbeDialogTransition).toHaveBeenCalledWith({
      from: 'awaiting_confirmation',
      to: 'resolved',
    });
  });

  it('идемпотентность: нет stale → ни одного update (no-op)', async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    await mocks.cron.sweep();

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.incProbeDialogOutcome).not.toHaveBeenCalled();
    expect(mocks.incProbeDialogTransition).not.toHaveBeenCalled();
  });

  it('where фильтр: обе awaiting-фазы + updatedAt.lt по TTL', async () => {
    mocks.findMany.mockResolvedValueOnce([]);

    await mocks.cron.sweep();

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const arg = mocks.findMany.mock.calls[0]![0] as {
      where: {
        phase: { in: string[] };
        updatedAt: { lt: Date };
      };
    };
    expect(arg.where.phase.in).toEqual(['awaiting_clarification', 'awaiting_confirmation']);
    expect(arg.where.updatedAt.lt).toBeInstanceOf(Date);
  });
});
