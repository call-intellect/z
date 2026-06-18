import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RecognitionService } from '../services/recognition.service';

import { StreakDetectorCron } from './streak-detector.cron';

interface MockPrisma {
  person: { findMany: ReturnType<typeof vi.fn> };
  dailyCheckIn: { count: ReturnType<typeof vi.fn> };
  contributionSnapshot: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
}

function mkCron(opts: {
  persons: Array<{
    id: string;
    userId: string | null;
    tenantId: string;
  }>;
  checkinExists: (personId: string) => boolean;
  prevSnapshots?: Record<string, { currentCheckinStreak: number; longestCheckinStreak: number }>;
}): {
  cron: StreakDetectorCron;
  prisma: MockPrisma;
  recognition: { enqueueFormulate: ReturnType<typeof vi.fn> };
} {
  const prisma: MockPrisma = {
    person: { findMany: vi.fn().mockResolvedValue(opts.persons) },
    dailyCheckIn: {
      count: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { personId: string } }) =>
          opts.checkinExists(where.personId) ? 1 : 0,
        ),
    },
    contributionSnapshot: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async ({ where }: { where: { userId: string } }) =>
            opts.prevSnapshots?.[where.userId] ?? null,
        ),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const recognition = {
    enqueueFormulate: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  };
  const cron = new StreakDetectorCron(
    prisma as unknown as PrismaService,
    recognition as unknown as RecognitionService,
  );
  return { cron, prisma, recognition };
}

describe('StreakDetectorCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('инкрементит streak при чек-ине сегодня', async () => {
    const { cron, prisma } = mkCron({
      persons: [{ id: 'p-1', userId: 'u-1', tenantId: 'org-1' }],
      checkinExists: () => true,
      prevSnapshots: {
        'u-1': { currentCheckinStreak: 5, longestCheckinStreak: 5 },
      },
    });
    await cron.run();
    expect(prisma.contributionSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-1' },
        update: {
          currentCheckinStreak: 6,
          longestCheckinStreak: 6,
        },
      }),
    );
  });

  it('сбрасывает streak в 0 при отсутствии чек-ина (но longest сохраняется)', async () => {
    const { cron, prisma } = mkCron({
      persons: [{ id: 'p-1', userId: 'u-1', tenantId: 'org-1' }],
      checkinExists: () => false,
      prevSnapshots: {
        'u-1': { currentCheckinStreak: 5, longestCheckinStreak: 10 },
      },
    });
    await cron.run();
    expect(prisma.contributionSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          currentCheckinStreak: 0,
          longestCheckinStreak: 10,
        },
      }),
    );
  });

  it('milestone 7 → emit Recognition streak_milestone', async () => {
    const { cron, recognition } = mkCron({
      persons: [{ id: 'p-1', userId: 'u-1', tenantId: 'org-1' }],
      checkinExists: () => true,
      prevSnapshots: {
        'u-1': { currentCheckinStreak: 6, longestCheckinStreak: 6 },
      },
    });
    await cron.run();
    expect(recognition.enqueueFormulate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'streak_milestone',
        toUserId: 'u-1',
        fromUserId: null,
        contextEntityType: 'checkin',
        contextEntityId: '7',
      }),
    );
  });

  it('non-milestone (3 дня) — НЕ emit Recognition', async () => {
    const { cron, recognition } = mkCron({
      persons: [{ id: 'p-1', userId: 'u-1', tenantId: 'org-1' }],
      checkinExists: () => true,
      prevSnapshots: {
        'u-1': { currentCheckinStreak: 2, longestCheckinStreak: 2 },
      },
    });
    await cron.run();
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });

  it('person без userId — пропускается', async () => {
    const { cron, prisma } = mkCron({
      persons: [{ id: 'p-1', userId: null, tenantId: 'org-1' }],
      checkinExists: () => true,
    });
    await cron.run();
    expect(prisma.contributionSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('ошибка по одному person не валит весь проход', async () => {
    const { cron, prisma, recognition } = mkCron({
      persons: [
        { id: 'p-bad', userId: 'u-bad', tenantId: 'org-1' },
        { id: 'p-ok', userId: 'u-ok', tenantId: 'org-1' },
      ],
      checkinExists: () => true,
    });
    prisma.dailyCheckIn.count.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    await cron.run();
    const upsertCalls = prisma.contributionSnapshot.upsert.mock.calls;
    const userIds = upsertCalls.map((c) => (c[0] as { where: { userId: string } }).where.userId);
    expect(userIds).toContain('u-ok');
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });
});
