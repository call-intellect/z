import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

const mockHandlers: Array<(channel: string, payload: string) => void> = [];
vi.mock('ioredis', () => {
  class FakeRedis {
    connect = vi.fn(async () => undefined);
    subscribe = vi.fn(async () => undefined);
    quit = vi.fn(async () => undefined);
    on(event: string, cb: (...args: unknown[]) => void): this {
      if (event === 'message') {
        mockHandlers.push(cb as (channel: string, payload: string) => void);
      }
      return this;
    }
  }
  return { default: FakeRedis };
});

import { AdminSettingsService } from './admin-settings.service';

interface MockStore {
  settings: Map<
    string,
    { value: unknown; updatedAt: Date; updatedBy: string | null; severity?: string }
  >;
  history: Array<{
    key: string;
    prevValue: unknown;
    newValue: unknown;
    changedBy: string;
    reason: string | null;
    changedAt: Date;
  }>;
  audit: Array<Record<string, unknown>>;
  publishes: string[];
}

function buildService(): {
  svc: AdminSettingsService;
  store: MockStore;
  publish: ReturnType<typeof vi.fn>;
  applySync: ReturnType<typeof vi.fn>;
} {
  const store: MockStore = {
    settings: new Map(),
    history: [],
    audit: [],
    publishes: [],
  };

  const publish = vi.fn(async (channel: string, payload: string) => {
    store.publishes.push(`${channel}:${payload}`);
    return 1;
  });
  const applySync = vi.fn();

  type AdminSettingRow = {
    key: string;
    value: unknown;
    updatedAt: Date;
    category: string;
    section: string;
    severity: string;
    schemaId: string | null;
    description: string | null;
    updatedBy: string | null;
    comment: string | null;
  };
  const rowFromStore = (key: string): AdminSettingRow | null => {
    const row = store.settings.get(key);
    if (!row) return null;
    return {
      key,
      value: row.value,
      updatedAt: row.updatedAt,
      category: 'platform',
      section: 'misc',
      severity: row.severity ?? 'low',
      schemaId: null,
      description: null,
      updatedBy: row.updatedBy,
      comment: null,
    };
  };

  const adminSetting = {
    findUnique: vi.fn(async (args: { where: { key: string } }) => rowFromStore(args.where.key)),
    findMany: vi.fn(async (args?: { where?: { key?: { in?: string[] } } }) => {
      const keys = args?.where?.key?.in;
      const out: AdminSettingRow[] = [];
      for (const [key] of store.settings.entries()) {
        if (!keys || keys.includes(key)) {
          const row = rowFromStore(key);
          if (row) out.push(row);
        }
      }
      return out;
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const key = args.data.key as string;
      store.settings.set(key, {
        value: args.data.value,
        updatedAt: new Date(),
        updatedBy: (args.data.updatedBy as string | null) ?? null,
      });
      return rowFromStore(key);
    }),
    update: vi.fn(async (args: { where: { key: string }; data: Record<string, unknown> }) => {
      const cur = store.settings.get(args.where.key);
      if (!cur) throw new Error('not found');
      store.settings.set(args.where.key, {
        value: args.data.value ?? cur.value,
        updatedAt: new Date(cur.updatedAt.getTime() + 1),
        updatedBy: (args.data.updatedBy as string | null) ?? cur.updatedBy,
        ...(cur.severity ? { severity: cur.severity } : {}),
      });
      return rowFromStore(args.where.key);
    }),
  };

  const adminSettingHistory = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      store.history.push({
        key: args.data.key as string,
        prevValue: args.data.prevValue,
        newValue: args.data.newValue,
        changedBy: args.data.changedBy as string,
        reason: (args.data.reason as string | null) ?? null,
        changedAt: new Date(),
      });
      return null;
    }),
    findMany: vi.fn(async (args: { where: { key: string }; orderBy: unknown; take: number }) => {
      const items = store.history.filter((h) => h.key === args.where.key);
      return items
        .slice()
        .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
        .slice(0, args.take)
        .map((h, i) => ({ id: `h-${i}`, ...h }));
    }),
  };

  const superAdminAccessLog = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      store.audit.push(args.data);
      return null;
    }),
  };

  const prisma = {
    adminSetting,
    adminSettingHistory,
    superAdminAccessLog,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ adminSetting, adminSettingHistory, superAdminAccessLog });
    }),
  } as unknown as PrismaService;

  const redis = {
    client: { publish },
  } as unknown as RedisService;

  const cfg = {
    redis: { url: 'redis://localhost:6379' },
    applySync,
  } as unknown as TypedConfigService;

  const svc = new AdminSettingsService(prisma, redis, cfg);
  return { svc, store, publish, applySync };
}

describe('AdminSettingsService', () => {
  it('get(): возвращает defaultValue для отсутствующего ключа', async () => {
    const { svc } = buildService();
    const v = await svc.get('absent.key', 42);
    expect(v).toBe(42);
  });

  it('get(): читает из БД, кеширует, повторный get не бьёт БД', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.foo', {
      value: 5,
      updatedAt: new Date(),
      updatedBy: null,
    });
    const v1 = await svc.get<number>('limits.foo');
    expect(v1).toBe(5);

    store.settings.delete('limits.foo');
    const v2 = await svc.get<number>('limits.foo');
    expect(v2).toBe(5);
  });

  it('set(): создаёт запись + history + audit + publish invalidate', async () => {
    const { svc, store, publish } = buildService();
    await svc.set('limits.bar', 100, { userId: 'user-1', reason: 'тест' });
    expect(store.settings.get('limits.bar')?.value).toBe(100);
    expect(store.history.length).toBe(1);
    expect(store.history[0]?.changedBy).toBe('user-1');
    expect(store.audit.length).toBe(1);
    expect(publish).toHaveBeenCalled();
  });

  it('set() optimistic concurrency: бросает Conflict при несовпадении updatedAt', async () => {
    const { svc, store } = buildService();
    const original = new Date('2020-01-01T00:00:00Z');
    store.settings.set('limits.baz', {
      value: 10,
      updatedAt: original,
      updatedBy: null,
    });

    await expect(
      svc.set('limits.baz', 20, {
        userId: 'user-1',
        expectedUpdatedAt: new Date('2099-01-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('getMany(): возвращает мапу + использует кеш', async () => {
    const { svc, store } = buildService();
    store.settings.set('a', { value: 1, updatedAt: new Date(), updatedBy: null });
    store.settings.set('b', { value: 2, updatedAt: new Date(), updatedBy: null });

    const m1 = await svc.getMany(['a', 'b', 'missing']);
    expect(m1).toEqual({ a: 1, b: 2 });

    store.settings.clear();
    const m2 = await svc.getMany(['a', 'b']);
    expect(m2).toEqual({ a: 1, b: 2 });
  });

  it('getHistory(): возвращает упорядоченную историю', async () => {
    const { svc, store } = buildService();
    await svc.set('limits.bar', 1, { userId: 'u1' });
    await svc.set('limits.bar', 2, { userId: 'u2' });
    await svc.set('limits.bar', 3, { userId: 'u3' });
    for (let i = 0; i < store.history.length; i++) {
      const entry = store.history[i];
      if (entry) entry.changedAt = new Date(2020, 0, 1, 0, 0, i);
    }
    const h = await svc.getHistory('limits.bar', 10);
    expect(h.length).toBe(3);
    expect(h[0]?.newValue).toBe(3);
    expect(h[2]?.newValue).toBe(1);
  });

  it('set() сбрасывает локальный кеш — следующий get() идёт в БД и видит свежее значение', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.x', {
      value: 7,
      updatedAt: new Date(),
      updatedBy: null,
    });
    expect(await svc.get<number>('limits.x')).toBe(7);

    await svc.set('limits.x', 99, { userId: 'u' });
    expect(await svc.get<number>('limits.x')).toBe(99);
  });

  it('set() вызывает cfg.applySync(key, value)', async () => {
    const { svc, applySync } = buildService();
    await svc.set('limits.foo', 123, { userId: 'u' });
    expect(applySync).toHaveBeenCalledWith('limits.foo', 123);
  });

  it('publishInvalidate шлёт payload с { key, value }, а не только { key }', async () => {
    const { svc, store } = buildService();
    await svc.set('limits.bar', { a: 1, b: 'x' }, { userId: 'u' });
    expect(store.publishes.length).toBe(1);
    const raw = store.publishes[0] ?? '';
    const channelPrefix = 'admin:setting:invalidate:';
    expect(raw.startsWith(channelPrefix)).toBe(true);
    const payload = raw.slice(channelPrefix.length);
    const parsed = JSON.parse(payload) as { key?: string; value?: unknown };
    expect(parsed.key).toBe('limits.bar');
    expect(parsed.value).toEqual({ a: 1, b: 'x' });
  });
});

describe('AdminSettingsService — серверная валидация set()', () => {
  it('зарегистрированный ключ с валидным значением — set проходит', async () => {
    const { svc, store } = buildService();
    await svc.set('knowledge.distillMergeThreshold', 0.5, { userId: 'u' });
    expect(store.settings.get('knowledge.distillMergeThreshold')?.value).toBe(0.5);
    expect(store.history.length).toBe(1);
  });

  it('зарегистрированный UNIT_INTERVAL-ключ с невалидным значением (5) — BadRequest, БД не тронута', async () => {
    const { svc, store } = buildService();
    await expect(
      svc.set('knowledge.distillMergeThreshold', 5, { userId: 'u' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.settings.has('knowledge.distillMergeThreshold')).toBe(false);
    expect(store.history.length).toBe(0);
  });

  it('severity=high и reason пустой — BadRequest', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.high', {
      value: 1,
      updatedAt: new Date(),
      updatedBy: null,
      severity: 'high',
    });
    await expect(svc.set('limits.high', 2, { userId: 'u' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.settings.get('limits.high')?.value).toBe(1);
  });

  it('severity=high и reason слишком короткий — BadRequest', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.high', {
      value: 1,
      updatedAt: new Date(),
      updatedBy: null,
      severity: 'high',
    });
    await expect(
      svc.set('limits.high', 2, { userId: 'u', reason: 'кор' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.settings.get('limits.high')?.value).toBe(1);
  });

  it('severity=high и reason достаточной длины — set проходит', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.high', {
      value: 1,
      updatedAt: new Date(),
      updatedBy: null,
      severity: 'high',
    });
    await svc.set('limits.high', 2, {
      userId: 'u',
      reason: 'обоснованная причина изменения',
    });
    expect(store.settings.get('limits.high')?.value).toBe(2);
  });

  it('severity=destructive и reason пустой — BadRequest', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.destr', {
      value: 1,
      updatedAt: new Date(),
      updatedBy: null,
      severity: 'destructive',
    });
    await expect(svc.set('limits.destr', 2, { userId: 'u' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('severity=low и reason пустой — set проходит (reason-gate не срабатывает)', async () => {
    const { svc, store } = buildService();
    store.settings.set('limits.low', {
      value: 1,
      updatedAt: new Date(),
      updatedBy: null,
      severity: 'low',
    });
    await svc.set('limits.low', 2, { userId: 'u' });
    expect(store.settings.get('limits.low')?.value).toBe(2);
  });

  it('незарегистрированный ключ без строки в БД — не кидает, пишет warn', async () => {
    const { svc, store } = buildService();
    const warnSpy = vi
      .spyOn(
        (svc as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    await svc.set('totally.unregistered.key', { anything: true }, { userId: 'u' });
    expect(store.settings.get('totally.unregistered.key')?.value).toEqual({ anything: true });
    expect(warnSpy).toHaveBeenCalledWith(
      'set() для незарегистрированного ключа totally.unregistered.key',
    );
  });
});

describe('AdminSettingsService — subscriber callback', () => {
  it('при получении { key, value } по pub/sub вызывает cfg.applySync(key, value)', async () => {
    mockHandlers.length = 0;
    const { svc, applySync } = buildService();
    await svc.onModuleInit();
    expect(mockHandlers.length).toBeGreaterThan(0);
    const handler = mockHandlers[mockHandlers.length - 1]!;
    handler('admin:setting:invalidate', JSON.stringify({ key: 'limits.x', value: 42 }));
    expect(applySync).toHaveBeenCalledWith('limits.x', 42);
    await svc.onModuleDestroy();
  });

  it('при получении { key } без value вызывает applySync(key, undefined) — fallback на ENV', async () => {
    mockHandlers.length = 0;
    const { svc, applySync } = buildService();
    await svc.onModuleInit();
    const handler = mockHandlers[mockHandlers.length - 1]!;
    handler('admin:setting:invalidate', JSON.stringify({ key: 'limits.y' }));
    expect(applySync).toHaveBeenCalledWith('limits.y', undefined);
    await svc.onModuleDestroy();
  });
});
