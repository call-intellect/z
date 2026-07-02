import { describe, expect, it, vi } from 'vitest';

import { CoreMetricsSnapshotCron } from './core-metrics-snapshot.cron';

function build(groups: Array<{ tenantId: string; sourceType: string; count: number }>) {
  const prisma = {
    rawEvent: {
      groupBy: vi.fn(async (_args: any) =>
        groups.map((g) => ({
          tenantId: g.tenantId,
          sourceType: g.sourceType,
          _count: { _all: g.count },
        })),
      ),
    },
  };
  const metrics = {
    resetRawEventStuck: vi.fn(),
    setRawEventStuck: vi.fn(),
  };
  const cfg = {
    getDynamic: vi.fn(async (_key: string, _env: unknown, def: number) => def),
  };
  const cron = new CoreMetricsSnapshotCron(prisma as any, metrics as any, cfg as any);
  return { cron, prisma, metrics, cfg };
}

describe('CoreMetricsSnapshotCron.snapshotRawEventStuck (F-9)', () => {
  it('reset + set по каждой (tenant, sourceType) группе застрявших RawEvent', async () => {
    const { cron, prisma, metrics, cfg } = build([
      { tenantId: 't1', sourceType: 'meeting', count: 3 },
      { tenantId: 't1', sourceType: 'chatbox', count: 1 },
      { tenantId: 't2', sourceType: 'meeting', count: 5 },
    ]);

    await (cron as any).snapshotRawEventStuck();

    expect(cfg.getDynamic).toHaveBeenCalledWith(
      'knowledge.rawEventRecoveryStaleMinutes',
      undefined,
      30,
    );
    const where = prisma.rawEvent.groupBy.mock.calls[0]![0].where;
    expect(where.processingStatus).toBe('received');
    expect(where.receivedAt.lt).toBeInstanceOf(Date);

    expect(metrics.resetRawEventStuck).toHaveBeenCalledTimes(1);
    expect(metrics.setRawEventStuck).toHaveBeenCalledTimes(3);
    expect(metrics.setRawEventStuck).toHaveBeenCalledWith({
      tenant: 't1',
      sourceType: 'meeting',
      count: 3,
    });
    expect(metrics.setRawEventStuck).toHaveBeenCalledWith({
      tenant: 't1',
      sourceType: 'chatbox',
      count: 1,
    });
    expect(metrics.setRawEventStuck).toHaveBeenCalledWith({
      tenant: 't2',
      sourceType: 'meeting',
      count: 5,
    });
  });

  it('пустой бэклог → reset вызван, ни одного set (разгруженные группы падают в absent)', async () => {
    const { cron, metrics } = build([]);

    await (cron as any).snapshotRawEventStuck();

    expect(metrics.resetRawEventStuck).toHaveBeenCalledTimes(1);
    expect(metrics.setRawEventStuck).not.toHaveBeenCalled();
  });
});
