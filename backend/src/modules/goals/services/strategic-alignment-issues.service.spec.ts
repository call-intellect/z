import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { StrategicAlignmentIssuesService } from './strategic-alignment-issues.service';

/**
 * Sprint 3 B1-3.2 — тесты на чистые вычисления:
 *   - compute(): score-формула 50%/50% + timeProgress + блокированные.
 *   - findMisalignedUsers(): порог 80% per-user за 30 дней.
 */

interface PrismaStubs {
  goalFindFirst?: ReturnType<typeof vi.fn>;
  issueCount?: ReturnType<typeof vi.fn>;
  issueFindMany?: ReturnType<typeof vi.fn>;
}

function makeService(stubs: PrismaStubs = {}): {
  svc: StrategicAlignmentIssuesService;
  prisma: PrismaService;
  redis: RedisService;
  goalFindFirst: ReturnType<typeof vi.fn>;
  issueCount: ReturnType<typeof vi.fn>;
  issueFindMany: ReturnType<typeof vi.fn>;
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
} {
  const goalFindFirst = stubs.goalFindFirst ?? vi.fn();
  const issueCount = stubs.issueCount ?? vi.fn(async () => 0);
  const issueFindMany = stubs.issueFindMany ?? vi.fn(async () => []);
  const prisma = {
    goal: { findFirst: goalFindFirst, findMany: vi.fn(async () => []) },
    issue: { count: issueCount, findMany: issueFindMany },
  } as unknown as PrismaService;

  const redisGet = vi.fn(async () => null as string | null);
  const redisSet = vi.fn(async () => 'OK');
  const redis = {
    client: { get: redisGet, set: redisSet },
  } as unknown as RedisService;

  const svc = new StrategicAlignmentIssuesService(prisma, redis);
  return { svc, prisma, redis, goalFindFirst, issueCount, issueFindMany, redisGet, redisSet };
}

describe('StrategicAlignmentIssuesService.compute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('бросает NotFoundException для несуществующей goal', async () => {
    const { svc, goalFindFirst } = makeService({
      goalFindFirst: vi.fn(async () => null),
    });
    await expect(svc.compute({ tenantId: 't1', goalId: 'gX' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(goalFindFirst).toHaveBeenCalled();
  });

  it('считает score: 50% completion + 50% recency', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const targetDate = new Date('2026-12-31T00:00:00Z');

    const counts = [10, 5, 2, 3]; // total, completed, blocked, recentlyUpdated
    let i = 0;
    const issueCount = vi.fn(async () => counts[i++]!);

    const { svc } = makeService({
      goalFindFirst: vi.fn(async () => ({
        id: 'g1',
        tenantId: 't1',
        createdAt,
        targetDate,
        archivedAt: null,
        status: 'active',
      })),
      issueCount,
    });

    const snap = await svc.compute({ tenantId: 't1', goalId: 'g1' });

    expect(snap.totalLinkedIssues).toBe(10);
    expect(snap.completedIssues).toBe(5);
    expect(snap.blockedIssues).toBe(2);
    expect(snap.recentlyUpdatedIssues).toBe(3);
    // completion = 5/10 * 50 = 25, recency = 50 (есть свежие), → 75.
    expect(snap.alignmentScore).toBe(75);
    expect(snap.timeProgressPct).not.toBeNull();
    expect(snap.timeProgressPct).toBeGreaterThanOrEqual(0);
    expect(snap.timeProgressPct).toBeLessThanOrEqual(100);
  });

  it('alignmentScore=0, если нет linked issues', async () => {
    const counts = [0, 0, 0, 0];
    let i = 0;
    const { svc } = makeService({
      goalFindFirst: vi.fn(async () => ({
        id: 'g1',
        tenantId: 't1',
        createdAt: new Date(),
        targetDate: null,
        archivedAt: null,
        status: 'active',
      })),
      issueCount: vi.fn(async () => counts[i++]!),
    });
    const snap = await svc.compute({ tenantId: 't1', goalId: 'g1' });
    expect(snap.alignmentScore).toBe(0);
    expect(snap.timeProgressPct).toBeNull();
  });

  it('recency=0 если нет свежей активности', async () => {
    const counts = [4, 1, 0, 0];
    let i = 0;
    const { svc } = makeService({
      goalFindFirst: vi.fn(async () => ({
        id: 'g1',
        tenantId: 't1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        targetDate: null,
        archivedAt: null,
        status: 'active',
      })),
      issueCount: vi.fn(async () => counts[i++]!),
    });
    const snap = await svc.compute({ tenantId: 't1', goalId: 'g1' });
    // completion = 1/4 * 50 = 12.5 → round = 13; recency = 0.
    expect(snap.alignmentScore).toBe(13);
  });
});

describe('StrategicAlignmentIssuesService.findMisalignedUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает пользователя ≥80% задач без goalId за 30д', async () => {
    // u1 — 10 задач, 9 без goalId (90%) → попадает.
    // u2 — 10 задач, 5 без goalId (50%) → не попадает.
    // u3 — 3 задачи, все без goalId (100%) → но total < MIN (5).
    const issues: Array<{
      id: string;
      goalId: string | null;
      assignees: Array<{ userId: string }>;
      createdById: string;
    }> = [];
    for (let i = 0; i < 10; i++) {
      issues.push({
        id: `iu1_${i}`,
        goalId: i < 9 ? null : 'g1',
        assignees: [{ userId: 'u1' }],
        createdById: 'creator',
      });
    }
    for (let i = 0; i < 10; i++) {
      issues.push({
        id: `iu2_${i}`,
        goalId: i < 5 ? null : 'g1',
        assignees: [{ userId: 'u2' }],
        createdById: 'creator',
      });
    }
    for (let i = 0; i < 3; i++) {
      issues.push({
        id: `iu3_${i}`,
        goalId: null,
        assignees: [{ userId: 'u3' }],
        createdById: 'creator',
      });
    }

    const { svc } = makeService({
      issueFindMany: vi.fn(async () => issues),
    });

    const result = await svc.findMisalignedUsers({ tenantId: 't1' });

    expect(result).toHaveLength(1);
    expect(result[0]!.userId).toBe('u1');
    expect(result[0]!.totalIssues).toBe(10);
    expect(result[0]!.issuesWithoutGoal).toBe(9);
    expect(result[0]!.ratio).toBeCloseTo(0.9);
  });

  it('считает по createdById, если assignees пуст', async () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`,
      goalId: null,
      assignees: [] as Array<{ userId: string }>,
      createdById: 'author',
    }));
    const { svc } = makeService({
      issueFindMany: vi.fn(async () => issues),
    });
    const result = await svc.findMisalignedUsers({ tenantId: 't1' });
    expect(result).toHaveLength(1);
    expect(result[0]!.userId).toBe('author');
    expect(result[0]!.totalIssues).toBe(8);
  });
});

describe('StrategicAlignmentIssuesService.getCached / setCached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCached возвращает null при пустом ключе', async () => {
    const { svc, redisGet } = makeService();
    redisGet.mockResolvedValueOnce(null);
    const res = await svc.getCached('g1');
    expect(res).toBeNull();
  });

  it('getCached возвращает snapshot при валидном JSON', async () => {
    const { svc, redisGet } = makeService();
    redisGet.mockResolvedValueOnce(
      JSON.stringify({
        goalId: 'g1',
        tenantId: 't1',
        totalLinkedIssues: 5,
        completedIssues: 2,
        blockedIssues: 1,
        recentlyUpdatedIssues: 3,
        timeProgressPct: 40,
        alignmentScore: 70,
        computedAt: '2026-05-24T10:00:00Z',
      }),
    );
    const res = await svc.getCached('g1');
    expect(res?.alignmentScore).toBe(70);
  });

  it('getCached возвращает null при невалидном JSON', async () => {
    const { svc, redisGet } = makeService();
    redisGet.mockResolvedValueOnce('not-json');
    const res = await svc.getCached('g1');
    expect(res).toBeNull();
  });

  it('setCached использует TTL и правильный ключ', async () => {
    const { svc, redisSet } = makeService();
    await svc.setCached({
      goalId: 'g42',
      tenantId: 't1',
      totalLinkedIssues: 1,
      completedIssues: 0,
      blockedIssues: 0,
      recentlyUpdatedIssues: 0,
      timeProgressPct: null,
      alignmentScore: 0,
      computedAt: new Date().toISOString(),
    });
    expect(redisSet).toHaveBeenCalledTimes(1);
    const call = redisSet.mock.calls[0]!;
    expect(call[0]).toBe('goal:issue-snapshot:g42');
    expect(call[2]).toBe('EX');
    expect(call[3]).toBe(StrategicAlignmentIssuesService.CACHE_TTL_SEC);
  });
});
