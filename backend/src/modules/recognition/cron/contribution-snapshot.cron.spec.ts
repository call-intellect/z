import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ContributionSnapshotCron } from './contribution-snapshot.cron';

interface MockPrisma {
  membership: { findMany: ReturnType<typeof vi.fn> };
  idea: { count: ReturnType<typeof vi.fn> };
  recognition: { count: ReturnType<typeof vi.fn> };
  issueComment: { findMany: ReturnType<typeof vi.fn> };
  notification: { count: ReturnType<typeof vi.fn> };
  contributionSnapshot: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

function mkCron(opts: {
  ideasInDev?: number;
  ideasShipped?: number;
  thanksTotal?: number;
  thanksWeek?: number;
  helpfulCounts?: number[];
  probesAnswered?: number;
  prevStreak?: { current: number; longest: number };
}): {
  cron: ContributionSnapshotCron;
  prisma: MockPrisma;
} {
  // idea.count вызывается дважды: in_progress + shipped
  let ideaCountCall = 0;
  let recogCountCall = 0;
  const prisma: MockPrisma = {
    membership: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'u-1' }]),
    },
    idea: {
      count: vi.fn().mockImplementation(async () => {
        ideaCountCall += 1;
        return ideaCountCall === 1
          ? opts.ideasInDev ?? 0
          : opts.ideasShipped ?? 0;
      }),
    },
    recognition: {
      count: vi.fn().mockImplementation(async () => {
        recogCountCall += 1;
        return recogCountCall === 1
          ? opts.thanksTotal ?? 0
          : opts.thanksWeek ?? 0;
      }),
    },
    issueComment: {
      findMany: vi.fn().mockResolvedValue(
        (opts.helpfulCounts ?? []).map((n) => ({
          thanksUserIds: Array.from({ length: n }, (_, i) => `u-${i}`),
        })),
      ),
    },
    notification: {
      count: vi.fn().mockResolvedValue(opts.probesAnswered ?? 0),
    },
    contributionSnapshot: {
      findUnique: vi.fn().mockResolvedValue(
        opts.prevStreak
          ? {
              currentCheckinStreak: opts.prevStreak.current,
              longestCheckinStreak: opts.prevStreak.longest,
            }
          : null,
      ),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const cron = new ContributionSnapshotCron(prisma as unknown as PrismaService);
  return { cron, prisma };
}

describe('ContributionSnapshotCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('агрегирует helpfulComments как сумму длин thanksUserIds', async () => {
    const { cron, prisma } = mkCron({
      helpfulCounts: [3, 2, 5], // итого 10
    });
    await cron.recomputeOne('u-1');
    const call = prisma.contributionSnapshot.upsert.mock.calls[0]?.[0] as {
      create: { helpfulComments: number };
    };
    expect(call.create.helpfulComments).toBe(10);
  });

  it('сохраняет существующие currentCheckinStreak / longestCheckinStreak', async () => {
    const { cron, prisma } = mkCron({
      prevStreak: { current: 5, longest: 12 },
    });
    await cron.recomputeOne('u-1');
    const call = prisma.contributionSnapshot.upsert.mock.calls[0]?.[0] as {
      create: { currentCheckinStreak: number; longestCheckinStreak: number };
      update: Record<string, unknown>;
    };
    expect(call.create.currentCheckinStreak).toBe(5);
    expect(call.create.longestCheckinStreak).toBe(12);
    // update не трогает streak (это поле обновляет StreakDetectorCron).
    expect(call.update.currentCheckinStreak).toBeUndefined();
    expect(call.update.longestCheckinStreak).toBeUndefined();
  });

  it('считает ideasInDevelopment + ideasShipped', async () => {
    const { cron, prisma } = mkCron({ ideasInDev: 3, ideasShipped: 2 });
    await cron.recomputeOne('u-1');
    const call = prisma.contributionSnapshot.upsert.mock.calls[0]?.[0] as {
      create: { ideasInDevelopment: number; ideasShipped: number };
    };
    expect(call.create.ideasInDevelopment).toBe(3);
    expect(call.create.ideasShipped).toBe(2);
  });

  it('считает thanksReceived и thanksReceivedWeek отдельно', async () => {
    const { cron, prisma } = mkCron({ thanksTotal: 25, thanksWeek: 4 });
    await cron.recomputeOne('u-1');
    const call = prisma.contributionSnapshot.upsert.mock.calls[0]?.[0] as {
      create: { thanksReceived: number; thanksReceivedWeek: number };
    };
    expect(call.create.thanksReceived).toBe(25);
    expect(call.create.thanksReceivedWeek).toBe(4);
  });

  it('считает probeQuestionsAnswered (Notification.responseStatus=answered)', async () => {
    const { cron, prisma } = mkCron({ probesAnswered: 7 });
    await cron.recomputeOne('u-1');
    const call = prisma.contributionSnapshot.upsert.mock.calls[0]?.[0] as {
      create: { probeQuestionsAnswered: number };
    };
    expect(call.create.probeQuestionsAnswered).toBe(7);
  });
});
