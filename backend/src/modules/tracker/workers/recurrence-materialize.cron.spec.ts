import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { IssueMaterializeService } from '../services/issue-materialize.service';
import { IssueRecurrencesService } from '../services/issue-recurrences.service';

import { RecurrenceMaterializeCron } from './recurrence-materialize.cron';

function makeCfg(overrides?: Record<string, unknown>): TypedConfigService {
  return {
    getDynamic: async <T>(key: string, _e: string | undefined, def: T): Promise<T> => {
      if (overrides && key in overrides) return overrides[key] as T;
      return def;
    },
    resolveSync: <T>(_k: string, _e: string | undefined, def: T): T => def,
  } as unknown as TypedConfigService;
}

describe('RecurrenceMaterializeCron', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let materializer: IssueMaterializeService;
  let cron: RecurrenceMaterializeCron;

  let recurrenceFindMany: ReturnType<typeof vi.fn>;
  let recurrenceUpdate: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;
  let materialize: ReturnType<typeof vi.fn>;

  const baseConfig = {
    title: 'Еженедельный отчёт',
    checklist: [{ title: 'Шаги', items: [{ text: 'Собрать цифры' }] }],
  };

  function makeRec(overrides?: Record<string, unknown>) {
    return {
      id: 'rec_1',
      tenantId: 'org_1',
      projectId: 'proj_1',
      templateIssueId: null,
      rrule: JSON.stringify({ freq: 'weekly', interval: 1 }),
      config: baseConfig,
      nextRunAt: new Date('2026-06-14T06:00:00.000Z'),
      lastRunAt: null,
      enabled: true,
      createdById: 'user_1',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    recurrenceFindMany = vi.fn().mockResolvedValue([makeRec()]);
    recurrenceUpdate = vi.fn().mockResolvedValue({ id: 'rec_1' });
    redisSet = vi.fn().mockResolvedValue('OK');
    materialize = vi.fn().mockResolvedValue({ issueId: 'issue_new' });

    prisma = {
      issueRecurrence: {
        findMany: recurrenceFindMany,
        update: recurrenceUpdate,
      },
    } as unknown as PrismaService;
    redis = { client: { set: redisSet } } as unknown as RedisService;
    materializer = { materialize } as unknown as IssueMaterializeService;

    cron = new RecurrenceMaterializeCron(prisma, redis, makeCfg(), materializer);
  });

  it('повторение с nextRunAt в прошлом материализует РОВНО ОДНУ задачу и сдвигает nextRunAt в будущее', async () => {
    const now = new Date('2026-06-21T06:00:00.000Z');
    const res = await cron.run(now);
    expect(res.materialized).toBe(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledWith({
      tenantId: 'org_1',
      projectId: 'proj_1',
      config: baseConfig,
      createdById: 'user_1',
    });
    expect(recurrenceUpdate).toHaveBeenCalledTimes(1);
    const updateArg = recurrenceUpdate.mock.calls[0]![0];
    expect(updateArg.data.lastRunAt).toEqual(now);
    expect((updateArg.data.nextRunAt as Date).getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });

  it('повторный прогон в тот же день — no-op (lastRunAt уже сегодня)', async () => {
    const now = new Date('2026-06-21T06:05:00.000Z');
    recurrenceFindMany.mockResolvedValueOnce([
      makeRec({
        lastRunAt: new Date('2026-06-21T06:00:00.000Z'),
        nextRunAt: new Date('2026-06-28T06:00:00.000Z'),
      }),
    ]);
    const res = await cron.run(now);
    expect(res.alreadyRanToday).toBe(1);
    expect(res.materialized).toBe(0);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('повторный прогон в тот же день — no-op (Redis dedup)', async () => {
    const now = new Date('2026-06-21T06:00:00.000Z');
    redisSet.mockResolvedValueOnce(null);
    const res = await cron.run(now);
    expect(res.dedupSkipped).toBe(1);
    expect(res.materialized).toBe(0);
    expect(materialize).not.toHaveBeenCalled();
    expect(recurrenceUpdate).not.toHaveBeenCalled();
  });

  it('kill-switch OFF — runScheduled не запускает проход', async () => {
    cron = new RecurrenceMaterializeCron(
      prisma,
      redis,
      makeCfg({ 'tracker.recurrenceEnabled': false }),
      materializer,
    );
    await cron.runScheduled();
    expect(recurrenceFindMany).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('advance: monthly+interval=2 сдвигает на два месяца', () => {
    const next = IssueRecurrencesService.advance(
      new Date('2026-01-15T06:00:00.000Z'),
      { freq: 'monthly', interval: 2 },
    );
    expect(next.toISOString()).toBe('2026-03-15T06:00:00.000Z');
  });
});
