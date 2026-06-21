import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DaySignalAggregatorService } from './day-signal-aggregator.service';
import type { DaySignalDetectResult } from './day-signal-detector.service';

const now = new Date('2026-06-21T18:00:00Z');

const person = { id: 'p1', tenantId: 't1', timezone: 'Europe/Moscow' };

const rawEvent = {
  id: 'e1',
  tenantId: 't1',
  sourceType: 'bitrix',
  payload: {},
  payloadStorage: 'inline',
  payloadS3Key: null,
  occurredAt: new Date('2026-06-21T10:00:00Z'),
};

const message = {
  personId: 'p1',
  text: 'сегодня план: X; сделал Y',
  source: 'bitrix' as const,
  occurredAt: new Date('2026-06-21T10:00:00Z'),
};

function cfgMock() {
  return {
    getDynamic: vi.fn(async (key: string): Promise<unknown> => {
      switch (key) {
        case 'daySignals.enabled':
          return true;
        case 'daySignals.processLocalHour':
          return 21;
        case 'daySignals.detectThreshold':
          return 0.7;
        default:
          return undefined;
      }
    }),
  };
}

function makeDeps(detectResult: DaySignalDetectResult, setResult: 'OK' | null = 'OK') {
  const prisma = {
    person: { findMany: vi.fn().mockResolvedValue([person]) },
    rawEvent: { findMany: vi.fn().mockResolvedValue([rawEvent]) },
  };
  const redis = { client: { set: vi.fn().mockResolvedValue(setResult) } };
  const cfg = cfgMock();
  const metrics = { incDaySignalBelowGate: vi.fn() };
  const extractor = { extractFromRawEvent: vi.fn().mockResolvedValue([message]) };
  const detector = { detect: vi.fn().mockResolvedValue(detectResult) };
  const checkins = { upsertFromDaySignal: vi.fn().mockResolvedValue({}) };
  const service = new DaySignalAggregatorService(
    prisma as never,
    redis as never,
    cfg as never,
    metrics as never,
    extractor as never,
    detector as never,
    checkins as never,
  );
  return { prisma, redis, cfg, metrics, extractor, detector, checkins, service };
}

describe('DaySignalAggregatorService', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('пишет план и отчёт при план+отчёт выше порога', async () => {
    deps = makeDeps({
      hasPlan: true,
      plan: { items: [{ text: 'X' }] },
      hasReport: true,
      report: { dones: [{ text: 'Y' }], blockers: [] },
      isPersonalNonWork: false,
      confidence: 0.9,
    });

    await deps.service.runOnce(now);

    expect(deps.checkins.upsertFromDaySignal).toHaveBeenCalledTimes(2);
    expect(deps.checkins.upsertFromDaySignal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'morning', personId: 'p1', source: 'bitrix' }),
    );
    expect(deps.checkins.upsertFromDaySignal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'evening', personId: 'p1' }),
    );
    expect(deps.metrics.incDaySignalBelowGate).not.toHaveBeenCalled();
  });

  it('идемпотентность: при отсутствии NX-замка не пишет', async () => {
    deps = makeDeps(
      {
        hasPlan: true,
        plan: { items: [{ text: 'X' }] },
        hasReport: true,
        report: { dones: [{ text: 'Y' }], blockers: [] },
        isPersonalNonWork: false,
        confidence: 0.9,
      },
      null,
    );

    await deps.service.runOnce(now);

    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
  });

  it('below-gate: низкая уверенность — метрика, без записи', async () => {
    deps = makeDeps({
      hasPlan: true,
      plan: { items: [{ text: 'X' }] },
      hasReport: false,
      report: { dones: [], blockers: [] },
      isPersonalNonWork: false,
      confidence: 0.5,
    });

    await deps.service.runOnce(now);

    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
    expect(deps.metrics.incDaySignalBelowGate).toHaveBeenCalledTimes(1);
  });

  it('kill-switch: при daySignals.enabled=false — ранний выход', async () => {
    deps = makeDeps({
      hasPlan: true,
      plan: { items: [{ text: 'X' }] },
      hasReport: false,
      report: { dones: [], blockers: [] },
      isPersonalNonWork: false,
      confidence: 0.9,
    });
    deps.cfg.getDynamic.mockImplementation(async (key: string): Promise<unknown> =>
      key === 'daySignals.enabled' ? false : undefined,
    );

    await deps.service.runOnce(now);

    expect(deps.prisma.person.findMany).not.toHaveBeenCalled();
    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
  });
});
