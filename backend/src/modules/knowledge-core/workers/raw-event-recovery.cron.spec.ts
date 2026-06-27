import { describe, expect, it, vi } from 'vitest';

import { RawEventRecoveryCron } from './raw-event-recovery.cron';

const NOW = new Date('2026-06-27T12:00:00Z');

function minutesAgo(min: number): Date {
  return new Date(NOW.getTime() - min * 60 * 1000);
}
function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000);
}

function makeCron(rows: Array<{ id: string; tenantId: string; receivedAt: Date }>) {
  const findMany = vi.fn(async () => rows);
  const prisma = {
    rawEvent: { findMany },
  } as unknown as ConstructorParameters<typeof RawEventRecoveryCron>[0];

  const enqueueRawReceived = vi.fn(async () => {});
  const coreQueue = { enqueueRawReceived } as unknown as ConstructorParameters<
    typeof RawEventRecoveryCron
  >[1];

  const incRawEventRecoveryReenqueued = vi.fn();
  const incRawEventRecoveryDeadLettered = vi.fn();
  const metrics = {
    incRawEventRecoveryReenqueued,
    incRawEventRecoveryDeadLettered,
  } as unknown as ConstructorParameters<typeof RawEventRecoveryCron>[2];

  const cfg = {
    getDynamic: vi.fn(),
  } as unknown as ConstructorParameters<typeof RawEventRecoveryCron>[3];

  const cron = new RawEventRecoveryCron(prisma, coreQueue, metrics, cfg);

  return {
    cron,
    findMany,
    enqueueRawReceived,
    incRawEventRecoveryReenqueued,
    incRawEventRecoveryDeadLettered,
  };
}

const STALE_MINUTES = 30;
const MAX_AGE_HOURS = 24;
const BATCH_LIMIT = 200;

function runArgs() {
  return { now: NOW, staleMinutes: STALE_MINUTES, maxAgeHours: MAX_AGE_HOURS, batchLimit: BATCH_LIMIT };
}

describe('RawEventRecoveryCron.runOnce — восстановление застрявших RawEvent (R22)', () => {
  it('RawEvent в окне [stale, maxAge] → реэнкьюй + метрика', async () => {
    const { cron, enqueueRawReceived, incRawEventRecoveryReenqueued } = makeCron([
      { id: 're-1', tenantId: 'org-1', receivedAt: hoursAgo(2) },
    ]);

    const res = await cron.runOnce(runArgs());

    expect(enqueueRawReceived).toHaveBeenCalledTimes(1);
    expect(enqueueRawReceived).toHaveBeenCalledWith('re-1', { suffix: 'recovery' });
    expect(incRawEventRecoveryReenqueued).toHaveBeenCalledTimes(1);
    expect(res.reenqueued).toBe(1);
    expect(res.deadLettered).toBe(0);
  });

  it('RawEvent старше maxAge → dead-letter метрика, НЕ реэнкьюй', async () => {
    const { cron, enqueueRawReceived, incRawEventRecoveryDeadLettered } = makeCron([
      { id: 're-old', tenantId: 'org-1', receivedAt: hoursAgo(48) },
    ]);

    const res = await cron.runOnce(runArgs());

    expect(enqueueRawReceived).not.toHaveBeenCalled();
    expect(incRawEventRecoveryDeadLettered).toHaveBeenCalledTimes(1);
    expect(res.deadLettered).toBe(1);
    expect(res.reenqueued).toBe(0);
  });

  it('смешанный набор: один в окне (реэнкьюй), один древний (dead-letter)', async () => {
    const {
      cron,
      enqueueRawReceived,
      incRawEventRecoveryReenqueued,
      incRawEventRecoveryDeadLettered,
    } = makeCron([
      { id: 're-fresh', tenantId: 'org-1', receivedAt: hoursAgo(1) },
      { id: 're-old', tenantId: 'org-2', receivedAt: hoursAgo(30) },
    ]);

    const res = await cron.runOnce(runArgs());

    expect(enqueueRawReceived).toHaveBeenCalledTimes(1);
    expect(enqueueRawReceived).toHaveBeenCalledWith('re-fresh', { suffix: 'recovery' });
    expect(incRawEventRecoveryReenqueued).toHaveBeenCalledTimes(1);
    expect(incRawEventRecoveryDeadLettered).toHaveBeenCalledTimes(1);
    expect(res.reenqueued).toBe(1);
    expect(res.deadLettered).toBe(1);
  });

  it('пустой набор → no-op', async () => {
    const { cron, enqueueRawReceived, incRawEventRecoveryReenqueued, incRawEventRecoveryDeadLettered } =
      makeCron([]);

    const res = await cron.runOnce(runArgs());

    expect(enqueueRawReceived).not.toHaveBeenCalled();
    expect(incRawEventRecoveryReenqueued).not.toHaveBeenCalled();
    expect(incRawEventRecoveryDeadLettered).not.toHaveBeenCalled();
    expect(res).toEqual({ reenqueued: 0, deadLettered: 0, scanned: 0 });
  });

  it('реэнкьюй одного RawEvent упал → не прерывает обработку остальных', async () => {
    const rows = [
      { id: 're-1', tenantId: 'org-1', receivedAt: hoursAgo(1) },
      { id: 're-2', tenantId: 'org-1', receivedAt: hoursAgo(1) },
    ];
    const { cron, enqueueRawReceived, incRawEventRecoveryReenqueued } = makeCron(rows);
    enqueueRawReceived.mockRejectedValueOnce(new Error('redis down'));

    const res = await cron.runOnce(runArgs());

    expect(enqueueRawReceived).toHaveBeenCalledTimes(2);
    expect(incRawEventRecoveryReenqueued).toHaveBeenCalledTimes(1);
    expect(res.reenqueued).toBe(1);
  });
});

describe('RawEventRecoveryCron.sweep — query + guard + рубильник', () => {
  it('слишком свежий (<stale) НЕ в выборке: where фильтрует по staleBefore', async () => {
    const { cron, findMany } = makeCron([]);
    (cron as unknown as { cfg: { getDynamic: ReturnType<typeof vi.fn> } }).cfg.getDynamic = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(STALE_MINUTES)
      .mockResolvedValueOnce(MAX_AGE_HOURS)
      .mockResolvedValueOnce(BATCH_LIMIT);

    await cron.sweep(NOW);

    const whereArg = (findMany.mock.calls[0] as unknown[] | undefined)?.[0] as {
      where: { processingStatus: string; receivedAt: { lt: Date } };
      take: number;
    };
    expect(whereArg.where.processingStatus).toBe('received');
    expect(whereArg.where.receivedAt.lt.getTime()).toBe(minutesAgo(STALE_MINUTES).getTime());
    expect(whereArg.take).toBe(BATCH_LIMIT);
  });

  it('рубильник OFF → ничего не делает', async () => {
    const { cron, findMany } = makeCron([{ id: 're-1', tenantId: 'org-1', receivedAt: hoursAgo(2) }]);
    (cron as unknown as { cfg: { getDynamic: ReturnType<typeof vi.fn> } }).cfg.getDynamic = vi
      .fn()
      .mockResolvedValueOnce(false);

    const res = await cron.sweep(NOW);

    expect(findMany).not.toHaveBeenCalled();
    expect(res).toEqual({ reenqueued: 0, deadLettered: 0, scanned: 0 });
  });

  it('prev run in progress → skip', async () => {
    const { cron, findMany } = makeCron([]);
    (cron as unknown as { running: boolean }).running = true;

    const res = await cron.sweep(NOW);

    expect(findMany).not.toHaveBeenCalled();
    expect(res).toEqual({ reenqueued: 0, deadLettered: 0, scanned: 0 });
  });
});
