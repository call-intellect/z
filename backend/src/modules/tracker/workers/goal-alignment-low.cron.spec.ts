import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { ProbeService } from '../../probe/probe.service';

import { GoalAlignmentLowCron } from './goal-alignment-low.cron';

const cfgStub = {
  getDynamic: async <T>(_k: string, _e: string | undefined, def: T): Promise<T> => def,
  resolveSync: <T>(_k: string, _e: string | undefined, def: T): T => def,
} as unknown as TypedConfigService;

describe('GoalAlignmentLowCron', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let metrics: BusinessMetricsService;
  let probe: ProbeService;
  let cron: GoalAlignmentLowCron;

  let orgFindMany: ReturnType<typeof vi.fn>;
  let membershipFindMany: ReturnType<typeof vi.fn>;
  let issueCount: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;
  let probeSuggest: ReturnType<typeof vi.fn>;
  let incProbeMetric: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    orgFindMany = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    membershipFindMany = vi
      .fn()
      .mockImplementation(async (args: { where?: { role?: unknown } }) => {
        if (args?.where?.role) {
          return [{ userId: 'owner_1' }];
        }
        return [{ userId: 'user_1' }];
      });
    issueCount = vi.fn();
    redisSet = vi.fn().mockResolvedValue('OK');
    probeSuggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'pe_1' });
    incProbeMetric = vi.fn();

    prisma = {
      org: { findMany: orgFindMany },
      membership: { findMany: membershipFindMany },
      issue: { count: issueCount },
    } as unknown as PrismaService;
    redis = {
      client: { set: redisSet },
    } as unknown as RedisService;
    metrics = {
      incProbeGoalAlignmentLowEmitted: incProbeMetric,
    } as unknown as BusinessMetricsService;
    probe = { suggest: probeSuggest } as unknown as ProbeService;

    cron = new GoalAlignmentLowCron(prisma, redis, metrics, cfgStub, probe);
  });

  it('Org с 0 пользователей — 0 probes (early return)', async () => {
    membershipFindMany.mockResolvedValueOnce([]);
    const res = await cron.run();
    expect(res.scannedUsers).toBe(0);
    expect(res.emitted).toBe(0);
    expect(probeSuggest).not.toHaveBeenCalled();
    expect(incProbeMetric).not.toHaveBeenCalled();
  });

  it('User с 10 issues, 9 без goalId (90%) — 1 probe + 1 инкремент метрики', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(9);
    const res = await cron.run();
    expect(res.emitted).toBe(1);
    expect(probeSuggest).toHaveBeenCalledTimes(1);
    const arg = probeSuggest.mock.calls[0]![0];
    expect(arg.tenantId).toBe('org_1');
    expect(arg.reason).toBe('goal_alignment_low');
    expect(arg.emittedByService).toBe('tracker.goal_alignment_low');
    expect(arg.payload.totalIssues).toBe(10);
    expect(arg.payload.withoutGoalCount).toBe(9);
    expect(arg.payload.targetUserId).toBe('user_1');
    expect(arg.payload.period).toBe('14d');
    expect(arg.recipientCandidates).toContain('user_1');
    expect(arg.recipientCandidates).toContain('owner_1');
    expect(incProbeMetric).toHaveBeenCalledWith({ tenantTop: expect.any(String) });
  });

  it('User с 10 issues, 5 без goalId (50%) — 0 probes (threshold 80%)', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(5);
    const res = await cron.run();
    expect(res.emitted).toBe(0);
    expect(probeSuggest).not.toHaveBeenCalled();
    expect(incProbeMetric).not.toHaveBeenCalled();
  });

  it('User с 3 issues (< MIN_ISSUES=5) — 0 probes', async () => {
    issueCount.mockResolvedValueOnce(3).mockResolvedValueOnce(3);
    const res = await cron.run();
    expect(res.emitted).toBe(0);
    expect(probeSuggest).not.toHaveBeenCalled();
  });

  it('Повторный run в тот же день — 0 probes (Redis dedup)', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(9);
    redisSet.mockResolvedValueOnce(null);
    const res = await cron.run();
    expect(res.emitted).toBe(0);
    expect(res.dedupSkipped).toBe(1);
    expect(probeSuggest).not.toHaveBeenCalled();
    expect(incProbeMetric).not.toHaveBeenCalled();
  });

  it('Probe ровно на пороге 80% (8/10) — эмитится 1 probe', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
    const res = await cron.run();
    expect(res.emitted).toBe(1);
    expect(probeSuggest).toHaveBeenCalledTimes(1);
  });

  it('Probe ровно на пороге 5 задач (5/5=100%) — эмитится 1 probe', async () => {
    issueCount.mockResolvedValueOnce(5).mockResolvedValueOnce(5);
    const res = await cron.run();
    expect(res.emitted).toBe(1);
  });

  it('ProbeService недоступен — не падает, 0 emits', async () => {
    cron = new GoalAlignmentLowCron(prisma, redis, metrics, cfgStub);
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(9);
    const res = await cron.run();
    expect(res.emitted).toBe(0);
    expect(incProbeMetric).not.toHaveBeenCalled();
  });

  it('ProbeService.suggest вернул dropped — метрика НЕ инкрементируется', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(9);
    probeSuggest.mockResolvedValueOnce({ dropped: 'rate_limit' });
    const res = await cron.run();
    expect(res.emitted).toBe(0);
    expect(incProbeMetric).not.toHaveBeenCalled();
  });

  it('count() для одного user вызывает Issue.count дважды с правильным where', async () => {
    issueCount.mockResolvedValueOnce(10).mockResolvedValueOnce(9);
    await cron.run();
    expect(issueCount).toHaveBeenCalledTimes(2);
    const w1 = issueCount.mock.calls[0]![0].where;
    expect(w1).toMatchObject({
      tenantId: 'org_1',
      createdById: 'user_1',
      deletedAt: null,
    });
    expect(w1.completedAt).toEqual({ gte: expect.any(Date) });
    const w2 = issueCount.mock.calls[1]![0].where;
    expect(w2).toMatchObject({
      tenantId: 'org_1',
      createdById: 'user_1',
      deletedAt: null,
      goalId: null,
    });
  });
});
