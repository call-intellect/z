import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EngagementScorerCron } from './engagement-scorer.cron';

interface MockBehavior {
  meetingBehaviorMetricsId: string;
  turnsCount: number;
}

interface BuildOpts {
  persons: Array<{ id: string; tenantId: string; userId: string | null }>;
  personBehaviors?: MockBehavior[];
  allBehaviorsByMetrics?: Record<string, MockBehavior[]>;
}

function buildCron(opts: BuildOpts): {
  cron: EngagementScorerCron;
  personUpdate: ReturnType<typeof vi.fn>;
  snapshotCreate: ReturnType<typeof vi.fn>;
} {
  const personFindMany = vi.fn(async () => opts.persons);
  const personUpdate = vi.fn();
  const snapshotCreate = vi.fn();

  const dailyCheckInFindMany = vi.fn(async () => []);
  const dailyCheckInCount = vi.fn(async () => 0);

  const behaviorFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args.where as {
      participant?: { userId?: string };
      meetingBehaviorMetricsId?: { in?: string[] };
    };
    if (where.participant?.userId) {
      return opts.personBehaviors ?? [];
    }
    const inFilter = where.meetingBehaviorMetricsId ?? {};
    const ids = inFilter.in ?? [];
    const result: MockBehavior[] = [];
    for (const id of ids) {
      const list = opts.allBehaviorsByMetrics?.[id] ?? [];
      result.push(...list);
    }
    return result;
  });

  const prisma = {
    person: {
      findMany: personFindMany,
      update: personUpdate,
    },
    dailyCheckIn: {
      findMany: dailyCheckInFindMany,
      count: dailyCheckInCount,
    },
    meetingParticipantBehavior: {
      findMany: behaviorFindMany,
    },
    personEngagementSnapshot: {
      create: snapshotCreate,
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  } as unknown as PrismaService;

  const cron = new EngagementScorerCron(prisma);
  return { cron, personUpdate, snapshotCreate };
}

function readSnapshotSignals(snapshotCreate: ReturnType<typeof vi.fn>): {
  meeting_activity: number;
  baseline: number;
} {
  const call = snapshotCreate.mock.calls[0]?.[0] as
    | { data: { signalsJson: { signals: Record<string, number>; baseline: number } } }
    | undefined;
  if (!call) throw new Error('snapshot.create не был вызван');
  const ma = call.data.signalsJson.signals.meeting_activity;
  if (typeof ma !== 'number') {
    throw new Error('meeting_activity отсутствует в signalsJson.signals');
  }
  return {
    meeting_activity: ma,
    baseline: call.data.signalsJson.baseline,
  };
}

describe('EngagementScorerCron — meeting_activity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });

  it('person.userId === null → meeting_activity = NEUTRAL_BASELINE', async () => {
    const { cron, snapshotCreate } = buildCron({
      persons: [{ id: 'p-1', tenantId: 't-1', userId: null }],
    });
    await cron.runOnce();
    expect(readSnapshotSignals(snapshotCreate).meeting_activity).toBe(0.5);
  });

  it('0 встреч за 14 дней → meeting_activity = NEUTRAL_BASELINE', async () => {
    const { cron, snapshotCreate } = buildCron({
      persons: [{ id: 'p-1', tenantId: 't-1', userId: 'u-1' }],
      personBehaviors: [],
    });
    await cron.runOnce();
    expect(readSnapshotSignals(snapshotCreate).meeting_activity).toBe(0.5);
  });

  it('ratio=2.0 (turn 30, avg 15) → meeting_activity = 1.0', async () => {
    const { cron, snapshotCreate } = buildCron({
      persons: [{ id: 'p-1', tenantId: 't-1', userId: 'u-1' }],
      personBehaviors: [{ meetingBehaviorMetricsId: 'm-1', turnsCount: 30 }],
      allBehaviorsByMetrics: {
        'm-1': [
          { meetingBehaviorMetricsId: 'm-1', turnsCount: 30 },
          { meetingBehaviorMetricsId: 'm-1', turnsCount: 10 },
          { meetingBehaviorMetricsId: 'm-1', turnsCount: 5 },
        ],
      },
    });
    await cron.runOnce();
    expect(readSnapshotSignals(snapshotCreate).meeting_activity).toBe(1);
  });

  it('avg = 0 (все молчали) → ratio = 1 → meeting_activity ≈ 0.444', async () => {
    const { cron, snapshotCreate } = buildCron({
      persons: [{ id: 'p-1', tenantId: 't-1', userId: 'u-1' }],
      personBehaviors: [{ meetingBehaviorMetricsId: 'm-1', turnsCount: 0 }],
      allBehaviorsByMetrics: {
        'm-1': [
          { meetingBehaviorMetricsId: 'm-1', turnsCount: 0 },
          { meetingBehaviorMetricsId: 'm-1', turnsCount: 0 },
        ],
      },
    });
    await cron.runOnce();
    expect(readSnapshotSignals(snapshotCreate).meeting_activity).toBeCloseTo(0.444, 3);
  });
});
