import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { BadgeAwarderCron } from './badge-awarder.cron';
import { BadgeConditionsService } from '../services/badge-conditions.service';

function mkCron(opts: {
  badges: Array<{ id: string; condition: unknown }>;
  snapshots: Array<Record<string, unknown>>;
  existingUserBadges?: Array<{ userId: string; badgeId: string }>;
}): {
  cron: BadgeAwarderCron;
  prisma: {
    badge: { findMany: ReturnType<typeof vi.fn> };
    contributionSnapshot: { findMany: ReturnType<typeof vi.fn> };
    userBadge: {
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
} {
  const userBadges = opts.existingUserBadges ?? [];
  const prisma = {
    badge: { findMany: vi.fn().mockResolvedValue(opts.badges) },
    contributionSnapshot: {
      findMany: vi.fn().mockResolvedValue(opts.snapshots),
    },
    userBadge: {
      findMany: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { userId: string } }) => {
          return userBadges
            .filter((u) => u.userId === where.userId)
            .map((u) => ({ badgeId: u.badgeId }));
        }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const cron = new BadgeAwarderCron(
    prisma as unknown as PrismaService,
    new BadgeConditionsService(),
  );
  return { cron, prisma };
}

describe('BadgeAwarderCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('пустой каталог Badge — ничего не делает', async () => {
    const { cron, prisma } = mkCron({ badges: [], snapshots: [] });
    await cron.run();
    expect(prisma.userBadge.create).not.toHaveBeenCalled();
  });

  it('выдаёт badge ideator когда ideasInDevelopment ≥ 5', async () => {
    const { cron, prisma } = mkCron({
      badges: [
        {
          id: 'badge-ideator',
          condition: { type: 'ideas_in_dev', threshold: 5 },
        },
      ],
      snapshots: [emptySnap('user-1', { ideasInDevelopment: 5 })],
    });
    await cron.run();
    expect(prisma.userBadge.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', badgeId: 'badge-ideator' },
    });
  });

  it('не выдаёт повторно (UserBadge уже есть)', async () => {
    const { cron, prisma } = mkCron({
      badges: [
        {
          id: 'badge-helper',
          condition: { type: 'helpful_comments', threshold: 20 },
        },
      ],
      snapshots: [emptySnap('user-1', { helpfulComments: 25 })],
      existingUserBadges: [{ userId: 'user-1', badgeId: 'badge-helper' }],
    });
    await cron.run();
    expect(prisma.userBadge.create).not.toHaveBeenCalled();
  });

  it('выдаёт только тот badge, чьи conditions выполнены', async () => {
    const { cron, prisma } = mkCron({
      badges: [
        {
          id: 'badge-helper',
          condition: { type: 'helpful_comments', threshold: 20 },
        },
        {
          id: 'badge-expert',
          condition: { type: 'thanks_received', threshold: 10 },
        },
        {
          id: 'badge-aligned',
          condition: { type: 'goal_alignment', threshold: 90 },
        },
      ],
      snapshots: [
        emptySnap('user-1', { helpfulComments: 25, thanksReceived: 3 }),
      ],
    });
    await cron.run();
    const calls = prisma.userBadge.create.mock.calls.map(
      (c) => (c[0] as { data: { badgeId: string } }).data.badgeId,
    );
    expect(calls).toContain('badge-helper');
    expect(calls).not.toContain('badge-expert');
    expect(calls).not.toContain('badge-aligned'); // goal_alignment = TODO false
  });

  it('игнорирует race-условие unique conflict (молча пропускает)', async () => {
    const { cron, prisma } = mkCron({
      badges: [
        {
          id: 'badge-ideator',
          condition: { type: 'ideas_in_dev', threshold: 5 },
        },
      ],
      snapshots: [emptySnap('user-1', { ideasInDevelopment: 5 })],
    });
    prisma.userBadge.create.mockRejectedValueOnce(new Error('unique violation'));
    // Не падает.
    await expect(cron.run()).resolves.not.toThrow();
  });
});

function emptySnap(
  userId: string,
  overrides: Partial<{
    ideasInDevelopment: number;
    ideasShipped: number;
    thanksReceived: number;
    thanksReceivedWeek: number;
    helpfulComments: number;
    probeQuestionsAnswered: number;
    currentCheckinStreak: number;
    longestCheckinStreak: number;
  }>,
): Record<string, unknown> {
  return {
    userId,
    ideasInDevelopment: 0,
    ideasShipped: 0,
    thanksReceived: 0,
    thanksReceivedWeek: 0,
    helpfulComments: 0,
    probeQuestionsAnswered: 0,
    currentCheckinStreak: 0,
    longestCheckinStreak: 0,
    ...overrides,
  };
}
