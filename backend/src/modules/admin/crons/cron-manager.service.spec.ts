/**
 * Admin-redesign Фаза 0 — unit-тесты `CronManagerService`.
 *
 * Покрываем:
 *   1) onModuleInit — мягко падает, если БД недоступна (warn, не throw).
 *   2) updateSchedule — UPSERT + audit + переподписка + pub/sub publish.
 *   3) triggerNow — успешный запуск: история success + lastRunAt обновлён.
 *   4) triggerNow — ошибочный запуск: история failed + ошибка в lastRunError.
 *   5) list — отдаёт объединённый результат БД + handler-mapping'а.
 */

import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { SchedulerRegistry } from '@nestjs/schedule';

import { CronManagerService } from './cron-manager.service';

interface CronStore {
  schedules: Map<
    string,
    {
      name: string;
      expression: string;
      defaultExpression: string;
      enabled: boolean;
      description: string | null;
      lastRunAt: Date | null;
      lastRunDurationMs: number | null;
      lastRunError: string | null;
      updatedBy: string | null;
    }
  >;
  runs: Array<{
    id: string;
    cronName: string;
    status: string;
    durationMs: number | null;
    error: string | null;
    triggeredBy: string | null;
    startedAt: Date;
  }>;
  audit: Array<Record<string, unknown>>;
  publishes: string[];
}

function buildService(opts: { dbAvailable: boolean } = { dbAvailable: true }): {
  svc: CronManagerService;
  store: CronStore;
} {
  const store: CronStore = {
    schedules: new Map(),
    runs: [],
    audit: [],
    publishes: [],
  };

  let runIdCounter = 0;
  const cronSchedule = {
    findMany: vi.fn(async () => {
      if (!opts.dbAvailable) throw new Error('db down');
      return Array.from(store.schedules.values());
    }),
    findUnique: vi.fn(async (args: { where: { name: string } }) => {
      return store.schedules.get(args.where.name) ?? null;
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const name = args.data.name as string;
      store.schedules.set(name, {
        name,
        expression: args.data.expression as string,
        defaultExpression: args.data.defaultExpression as string,
        enabled: (args.data.enabled as boolean | undefined) ?? true,
        description: (args.data.description as string | null | undefined) ?? null,
        lastRunAt: null,
        lastRunDurationMs: null,
        lastRunError: null,
        updatedBy: (args.data.updatedBy as string | null | undefined) ?? null,
      });
      return store.schedules.get(name);
    }),
    update: vi.fn(
      async (args: { where: { name: string }; data: Record<string, unknown> }) => {
        const cur = store.schedules.get(args.where.name);
        if (!cur) throw new Error('not found');
        const next = { ...cur, ...args.data };
        store.schedules.set(args.where.name, next as typeof cur);
        return next;
      },
    ),
    updateMany: vi.fn(
      async (args: { where: { name: string }; data: Record<string, unknown> }) => {
        const cur = store.schedules.get(args.where.name);
        if (cur) {
          store.schedules.set(args.where.name, { ...cur, ...args.data } as typeof cur);
        }
        return { count: cur ? 1 : 0 };
      },
    ),
  };

  const cronRunHistory = {
    findMany: vi.fn(
      async (
        args?: {
          where?: { cronName?: string | { in: string[] } };
          orderBy?: { startedAt?: 'asc' | 'desc' };
          take?: number;
        },
      ) => {
        let rows = store.runs.slice();
        const where = args?.where?.cronName;
        if (typeof where === 'string') {
          rows = rows.filter((r) => r.cronName === where);
        } else if (where && Array.isArray(where.in)) {
          const set = new Set(where.in);
          rows = rows.filter((r) => set.has(r.cronName));
        }
        if (args?.orderBy?.startedAt === 'desc') {
          rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        } else if (args?.orderBy?.startedAt === 'asc') {
          rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
        }
        if (typeof args?.take === 'number') {
          rows = rows.slice(0, args.take);
        }
        return rows;
      },
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      runIdCounter += 1;
      const row = {
        id: `r-${runIdCounter}`,
        cronName: args.data.cronName as string,
        status: args.data.status as string,
        durationMs: (args.data.durationMs as number | null | undefined) ?? null,
        error: (args.data.error as string | null | undefined) ?? null,
        triggeredBy: (args.data.triggeredBy as string | null | undefined) ?? null,
        startedAt: new Date(),
      };
      store.runs.push(row);
      return row;
    }),
    update: vi.fn(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = store.runs.findIndex((r) => r.id === args.where.id);
        if (idx >= 0) {
          store.runs[idx] = { ...store.runs[idx], ...args.data } as (typeof store.runs)[number];
        }
        return store.runs[idx];
      },
    ),
  };

  const superAdminAccessLog = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      store.audit.push(args.data);
      return null;
    }),
  };

  const prisma = {
    cronSchedule,
    cronRunHistory,
    superAdminAccessLog,
    $transaction: vi.fn(
      async (
        input:
          | ((tx: unknown) => Promise<unknown>)
          | Array<Promise<unknown>>,
      ) => {
        if (typeof input === 'function') {
          return input({ cronSchedule, cronRunHistory, superAdminAccessLog });
        }
        return Promise.all(input);
      },
    ),
  } as unknown as PrismaService;

  const publish = vi.fn(async (channel: string, payload: string) => {
    store.publishes.push(`${channel}:${payload}`);
    return 1;
  });
  const redis = { client: { publish } } as unknown as RedisService;
  const cfg = {
    redis: { url: 'redis://localhost:6379' },
  } as unknown as TypedConfigService;

  const discovery = {
    getProviders: vi.fn(() => []),
  } as unknown as DiscoveryService;
  const scanner = {
    getAllMethodNames: vi.fn(() => []),
  } as unknown as MetadataScanner;
  const reflector = {
    get: vi.fn(() => undefined),
  } as unknown as Reflector;
  const scheduler = {
    deleteCronJob: vi.fn(() => undefined),
    addCronJob: vi.fn(() => undefined),
    getCronJobs: vi.fn(() => new Map()),
  } as unknown as SchedulerRegistry;

  const svc = new CronManagerService(
    prisma,
    redis,
    cfg,
    discovery,
    scanner,
    reflector,
    scheduler,
  );
  return { svc, store };
}

describe('CronManagerService', () => {
  it('updateSchedule(): создаёт CronSchedule + audit + publish', async () => {
    const { svc, store } = buildService();
    svc.registerHandlerForTest('test-cron', async () => undefined, '0 * * * *');

    await svc.updateSchedule(
      'test-cron',
      { expression: '*/5 * * * *', enabled: true },
      'super-1',
      'тестовая правка',
    );

    expect(store.schedules.get('test-cron')?.expression).toBe('*/5 * * * *');
    expect(store.audit.length).toBe(1);
    expect(store.publishes.some((p) => p.includes('test-cron'))).toBe(true);
  });

  it('updateSchedule(): несуществующий cron — NotFoundException', async () => {
    const { svc } = buildService();
    await expect(
      svc.updateSchedule('unknown', { expression: '* * * * *' }, 'super-1'),
    ).rejects.toThrow();
  });

  it('triggerNow(): успешный запуск пишет success в CronRunHistory + lastRunAt', async () => {
    const { svc, store } = buildService();
    const handler = vi.fn(async () => undefined);
    svc.registerHandlerForTest('manual-cron', handler, '0 * * * *');
    // создадим запись расписания, чтобы updateMany нашёл её
    store.schedules.set('manual-cron', {
      name: 'manual-cron',
      expression: '0 * * * *',
      defaultExpression: '0 * * * *',
      enabled: true,
      description: null,
      lastRunAt: null,
      lastRunDurationMs: null,
      lastRunError: null,
      updatedBy: null,
    });

    const res = await svc.triggerNow('manual-cron', 'super-1');
    expect(res.ok).toBe(true);
    expect(handler).toHaveBeenCalled();
    const last = store.runs[store.runs.length - 1];
    expect(last?.status).toBe('success');
    expect(store.schedules.get('manual-cron')?.lastRunAt).toBeInstanceOf(Date);
  });

  it('triggerNow(): ошибочный handler пишет failed + lastRunError', async () => {
    const { svc, store } = buildService();
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    svc.registerHandlerForTest('fail-cron', handler, '0 * * * *');
    store.schedules.set('fail-cron', {
      name: 'fail-cron',
      expression: '0 * * * *',
      defaultExpression: '0 * * * *',
      enabled: true,
      description: null,
      lastRunAt: null,
      lastRunDurationMs: null,
      lastRunError: null,
      updatedBy: null,
    });

    const res = await svc.triggerNow('fail-cron', 'super-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
    expect(store.schedules.get('fail-cron')?.lastRunError).toContain('boom');
  });

  it('list(): отдаёт объединение БД-записей и handler-mapping', async () => {
    const { svc, store } = buildService();
    svc.registerHandlerForTest('only-code', async () => undefined, '0 * * * *');
    store.schedules.set('only-db', {
      name: 'only-db',
      expression: '*/2 * * * *',
      defaultExpression: '*/2 * * * *',
      enabled: true,
      description: 'orphaned db row',
      lastRunAt: null,
      lastRunDurationMs: null,
      lastRunError: null,
      updatedBy: null,
    });

    const items = await svc.list();
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['only-code', 'only-db']);
  });

  it('onModuleInit(): без падения, если БД недоступна', async () => {
    const { svc } = buildService({ dbAvailable: false });
    // Не подключаем subscriber (Redis тоже мокируем) — onModuleInit
    // должен мягко проглотить и БД-сбой, и pub/sub-сбой.
    await expect(svc.onModuleInit()).resolves.not.toThrow();
  });

  it('listWithHistory(): объединяет CronSchedule + последние 10 запусков на крон', async () => {
    const { svc, store } = buildService();
    svc.registerHandlerForTest('only-code', async () => undefined, '0 * * * *');
    store.schedules.set('with-runs', {
      name: 'with-runs',
      expression: '*/5 * * * *',
      defaultExpression: '*/5 * * * *',
      enabled: true,
      description: 'has history',
      lastRunAt: null,
      lastRunDurationMs: null,
      lastRunError: null,
      updatedBy: null,
    });
    // Накидаем 12 записей истории для with-runs — должно быть отсечено до 10.
    for (let i = 0; i < 12; i += 1) {
      store.runs.push({
        id: `h-${i}`,
        cronName: 'with-runs',
        status: 'success',
        durationMs: 100 + i,
        error: null,
        triggeredBy: null,
        startedAt: new Date(Date.now() - i * 60_000),
      });
    }
    // findMany нашего мока вернёт ВСЁ; сервис сам должен отсечь до 10 на крон.
    // Чтобы порядок DESC по startedAt — переопределим findMany сортировкой.
    (
      store.runs as Array<{ startedAt: Date }>
    ).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const items = await svc.listWithHistory();
    const withRuns = items.find((i) => i.name === 'with-runs');
    expect(withRuns).toBeTruthy();
    expect(withRuns?.recentRuns.length).toBe(10);
    const onlyCode = items.find((i) => i.name === 'only-code');
    expect(onlyCode?.recentRuns.length).toBe(0);
  });

  it('getHistory(): возвращает только историю указанного крона с учётом limit', async () => {
    const { svc, store } = buildService();
    for (let i = 0; i < 5; i += 1) {
      store.runs.push({
        id: `hist-${i}`,
        cronName: 'cron-a',
        status: 'success',
        durationMs: 50,
        error: null,
        triggeredBy: null,
        startedAt: new Date(Date.now() - i * 60_000),
      });
    }
    store.runs.push({
      id: 'other',
      cronName: 'cron-b',
      status: 'success',
      durationMs: 50,
      error: null,
      triggeredBy: null,
      startedAt: new Date(),
    });

    const rows = await svc.getHistory('cron-a', 3);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.id.startsWith('hist-'))).toBe(true);
  });
});
