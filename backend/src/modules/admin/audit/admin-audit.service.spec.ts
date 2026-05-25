/**
 * Admin-redesign Фаза 1 — unit-тесты `AdminAuditService`.
 *
 * Покрываем:
 *   1) list(): фильтр по adminUserId передаётся в where.
 *   2) list(): фильтр по периоду (from/to) формирует createdAt range.
 *   3) list(): cursor pagination — следующая страница отдаёт более старые.
 *   4) list(): nextCursor === null когда страница последняя.
 *   5) listAdmins(): аггрегирует action counts + lastActionAt + JOIN'ит email.
 *   6) stats(): группирует по routes/methods за период.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminAuditService } from './admin-audit.service';

interface LogRow {
  id: string;
  superAdminUserId: string;
  accessedTenantId: string | null;
  route: string;
  method: string;
  params: unknown;
  reason: string | null;
  createdAt: Date;
  superAdmin: { email: string } | null;
}

function buildService(logs: LogRow[] = []): {
  svc: AdminAuditService;
  spies: {
    findMany: ReturnType<typeof vi.fn>;
    groupByLog: ReturnType<typeof vi.fn>;
    countLog: ReturnType<typeof vi.fn>;
    findManyUser: ReturnType<typeof vi.fn>;
  };
} {
  const findMany = vi.fn(
    async (args: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      take?: number;
      include?: unknown;
    }) => {
      let rows = [...logs].sort((a, b) => {
        const t = b.createdAt.getTime() - a.createdAt.getTime();
        if (t !== 0) return t;
        return b.id.localeCompare(a.id);
      });
      const where = (args.where ?? {}) as Record<string, unknown>;
      if (typeof where.superAdminUserId === 'string') {
        rows = rows.filter((r) => r.superAdminUserId === where.superAdminUserId);
      }
      if (typeof where.accessedTenantId === 'string') {
        rows = rows.filter((r) => r.accessedTenantId === where.accessedTenantId);
      }
      if (typeof where.method === 'string') {
        rows = rows.filter((r) => r.method === where.method);
      }
      const createdAt = where.createdAt as
        | { gte?: Date; lt?: Date }
        | undefined;
      if (createdAt) {
        if (createdAt.gte)
          rows = rows.filter((r) => r.createdAt >= (createdAt.gte as Date));
        if (createdAt.lt)
          rows = rows.filter((r) => r.createdAt < (createdAt.lt as Date));
      }
      const andClauses = where.AND as
        | Array<{ OR?: Array<Record<string, unknown>> }>
        | undefined;
      if (andClauses) {
        for (const clause of andClauses) {
          const or = clause.OR;
          if (!or) continue;
          rows = rows.filter((r) =>
            or.some((cond) => {
              const ca = (cond as Record<string, unknown>).createdAt as
                | { lt?: Date }
                | Date
                | undefined;
              const idCond = (cond as Record<string, unknown>).id as
                | { lt?: string }
                | undefined;
              if (
                ca &&
                typeof ca === 'object' &&
                'lt' in ca &&
                ca.lt instanceof Date &&
                !idCond
              ) {
                return r.createdAt < ca.lt;
              }
              if (ca instanceof Date && idCond?.lt) {
                return (
                  r.createdAt.getTime() === ca.getTime() && r.id < idCond.lt
                );
              }
              return false;
            }),
          );
        }
      }
      const take = args.take ?? rows.length;
      return rows.slice(0, take);
    },
  );

  const groupByLog = vi.fn(
    async (args: {
      by: string[];
      where?: Record<string, unknown>;
      _count?: unknown;
      _max?: { createdAt?: boolean };
    }) => {
      let rows = [...logs];
      const where = (args.where ?? {}) as Record<string, unknown>;
      const createdAt = where.createdAt as
        | { gte?: Date; lt?: Date }
        | undefined;
      if (createdAt) {
        if (createdAt.gte)
          rows = rows.filter((r) => r.createdAt >= (createdAt.gte as Date));
        if (createdAt.lt)
          rows = rows.filter((r) => r.createdAt < (createdAt.lt as Date));
      }
      const groupBy = args.by[0];
      const buckets = new Map<
        string,
        { count: number; maxCreatedAt: Date | null }
      >();
      for (const r of rows) {
        const key = (r as unknown as Record<string, unknown>)[
          groupBy as string
        ] as string;
        const b = buckets.get(key) ?? { count: 0, maxCreatedAt: null };
        b.count += 1;
        if (!b.maxCreatedAt || r.createdAt > b.maxCreatedAt) {
          b.maxCreatedAt = r.createdAt;
        }
        buckets.set(key, b);
      }
      return Array.from(buckets.entries()).map(([key, b]) => ({
        [groupBy as string]: key,
        _count: { _all: b.count },
        _max: args._max?.createdAt ? { createdAt: b.maxCreatedAt } : {},
      }));
    },
  );

  const countLog = vi.fn(async (args: { where?: Record<string, unknown> }) => {
    let rows = [...logs];
    const where = (args.where ?? {}) as Record<string, unknown>;
    const createdAt = where.createdAt as
      | { gte?: Date; lt?: Date }
      | undefined;
    if (createdAt) {
      if (createdAt.gte)
        rows = rows.filter((r) => r.createdAt >= (createdAt.gte as Date));
      if (createdAt.lt)
        rows = rows.filter((r) => r.createdAt < (createdAt.lt as Date));
    }
    return rows.length;
  });

  const findManyUser = vi.fn(
    async (args: { where: { id: { in: string[] } } }) => {
      const ids = args.where.id.in;
      const users: Array<{ id: string; email: string; name: string }> = [];
      const seen = new Set<string>();
      for (const log of logs) {
        if (!ids.includes(log.superAdminUserId)) continue;
        if (seen.has(log.superAdminUserId)) continue;
        seen.add(log.superAdminUserId);
        users.push({
          id: log.superAdminUserId,
          email: log.superAdmin?.email ?? `${log.superAdminUserId}@example.com`,
          name: log.superAdminUserId,
        });
      }
      return users;
    },
  );

  const prisma = {
    superAdminAccessLog: {
      findMany,
      groupBy: groupByLog,
      count: countLog,
    },
    user: { findMany: findManyUser },
  } as unknown as PrismaService;

  const svc = new AdminAuditService(prisma);
  return { svc, spies: { findMany, groupByLog, countLog, findManyUser } };
}

function makeLog(over: Partial<LogRow>): LogRow {
  return {
    id: over.id ?? 'log-1',
    superAdminUserId: over.superAdminUserId ?? 'user-1',
    accessedTenantId: over.accessedTenantId ?? null,
    route: over.route ?? 'admin/settings',
    method: over.method ?? 'GET',
    params: over.params ?? null,
    reason: over.reason ?? null,
    createdAt: over.createdAt ?? new Date('2026-05-25T10:00:00Z'),
    superAdmin: over.superAdmin ?? { email: 'admin@example.com' },
  };
}

describe('AdminAuditService', () => {
  it('list(): фильтр по adminUserId передаётся в where', async () => {
    const { svc, spies } = buildService([
      makeLog({ id: '1', superAdminUserId: 'a' }),
      makeLog({ id: '2', superAdminUserId: 'b' }),
    ]);
    const res = await svc.list({ adminUserId: 'a', limit: 50 });
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.superAdminUserId).toBe('a');
    const call = spies.findMany.mock.calls[0]?.[0] as {
      where: { superAdminUserId?: string };
    };
    expect(call.where.superAdminUserId).toBe('a');
  });

  it('list(): фильтр по периоду формирует createdAt range', async () => {
    const { svc } = buildService([
      makeLog({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
      makeLog({ id: 'mid', createdAt: new Date('2026-05-20T00:00:00Z') }),
      makeLog({ id: 'new', createdAt: new Date('2026-06-01T00:00:00Z') }),
    ]);
    const res = await svc.list({
      from: new Date('2026-05-01T00:00:00Z'),
      to: new Date('2026-05-25T00:00:00Z'),
      limit: 50,
    });
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.id).toBe('mid');
  });

  it('list(): cursor pagination — следующая страница отдаёт более старые записи', async () => {
    const logs: LogRow[] = [];
    for (let i = 0; i < 5; i++) {
      logs.push(
        makeLog({
          id: `id-${i}`,
          createdAt: new Date(2026, 4, 25, 10, i),
        }),
      );
    }
    const { svc } = buildService(logs);
    const page1 = await svc.list({ limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(['id-4', 'id-3']);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await svc.list({
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(page2.items.map((i) => i.id)).toEqual(['id-2', 'id-1']);

    const page3 = await svc.list({
      limit: 2,
      cursor: page2.nextCursor as string,
    });
    expect(page3.items.map((i) => i.id)).toEqual(['id-0']);
    expect(page3.nextCursor).toBeNull();
  });

  it('list(): nextCursor === null когда страница последняя', async () => {
    const { svc } = buildService([
      makeLog({ id: '1' }),
      makeLog({ id: '2', createdAt: new Date('2026-05-25T09:00:00Z') }),
    ]);
    const res = await svc.list({ limit: 50 });
    expect(res.items.length).toBe(2);
    expect(res.nextCursor).toBeNull();
  });

  it('listAdmins(): аггрегирует counts + lastActionAt + JOINит email', async () => {
    const { svc } = buildService([
      makeLog({
        id: '1',
        superAdminUserId: 'admin-a',
        createdAt: new Date('2026-05-25T10:00:00Z'),
        superAdmin: { email: 'a@example.com' },
      }),
      makeLog({
        id: '2',
        superAdminUserId: 'admin-a',
        createdAt: new Date('2026-05-25T11:00:00Z'),
        superAdmin: { email: 'a@example.com' },
      }),
      makeLog({
        id: '3',
        superAdminUserId: 'admin-b',
        createdAt: new Date('2026-05-24T10:00:00Z'),
        superAdmin: { email: 'b@example.com' },
      }),
    ]);
    const res = await svc.listAdmins();
    expect(res.length).toBe(2);
    const a = res.find((r) => r.superAdminUserId === 'admin-a');
    expect(a?.totalActions).toBe(2);
    expect(a?.email).toBe('a@example.com');
    expect(a?.lastActionAt?.toISOString()).toBe('2026-05-25T11:00:00.000Z');
    // Сортировка: свежие первыми.
    expect(res[0]?.superAdminUserId).toBe('admin-a');
  });

  it('stats(): группирует по routes/methods за период', async () => {
    // recent должен быть строго В прошлом, иначе stats(to=now()) отсечёт.
    const recent = new Date(Date.now() - 60_000);
    const old = new Date(recent.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 дней назад
    const { svc } = buildService([
      makeLog({ id: '1', route: 'admin/settings', method: 'GET', createdAt: recent }),
      makeLog({ id: '2', route: 'admin/settings', method: 'POST', createdAt: recent }),
      makeLog({ id: '3', route: 'admin/crons', method: 'POST', createdAt: recent }),
      makeLog({ id: 'old', route: 'admin/old', method: 'GET', createdAt: old }),
    ]);
    const res = await svc.stats('week');
    expect(res.totalActions).toBe(3);
    expect(res.routes.find((r) => r.route === 'admin/settings')?.count).toBe(2);
    expect(res.routes.find((r) => r.route === 'admin/old')).toBeUndefined();
    expect(res.methods.find((m) => m.method === 'POST')?.count).toBe(2);
    expect(res.methods.find((m) => m.method === 'GET')?.count).toBe(1);
    expect(res.period).toBe('week');
  });
});
