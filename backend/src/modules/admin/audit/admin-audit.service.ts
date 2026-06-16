import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface AuditItem {
  id: string;
  superAdminUserId: string;
  superAdminEmail: string | null;
  accessedTenantId: string | null;
  route: string;
  method: string;
  params: unknown;
  reason: string | null;
  createdAt: Date;
}

export interface AuditListResult {
  items: AuditItem[];
  nextCursor: string | null;
}

export interface AdminSummary {
  superAdminUserId: string;
  email: string | null;
  name: string | null;
  totalActions: number;
  lastActionAt: Date | null;
}

export interface AuditStats {
  period: 'day' | 'week' | 'month';
  from: Date;
  to: Date;
  totalActions: number;
  routes: Array<{ route: string; count: number }>;
  methods: Array<{ method: string; count: number }>;
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: {
    adminUserId?: string;
    tenantId?: string;
    route?: string;
    method?: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    limit: number;
  }): Promise<AuditListResult> {
    const where: Prisma.SuperAdminAccessLogWhereInput = {};
    if (filters.adminUserId) where.superAdminUserId = filters.adminUserId;
    if (filters.tenantId) where.accessedTenantId = filters.tenantId;
    if (filters.route) where.route = { contains: filters.route, mode: 'insensitive' };
    if (filters.method) where.method = filters.method;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lt = filters.to;
    }

    const decoded = filters.cursor ? this.decodeCursor(filters.cursor) : null;
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const orConditions: Prisma.SuperAdminAccessLogWhereInput[] = [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: decoded.id } },
      ];
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: orConditions }];
    }

    const rows = await this.prisma.superAdminAccessLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
      include: {
        superAdmin: {
          select: { email: true },
        },
      },
    });

    const hasMore = rows.length > filters.limit;
    const slice = hasMore ? rows.slice(0, filters.limit) : rows;

    const items: AuditItem[] = slice.map((r) => ({
      id: r.id,
      superAdminUserId: r.superAdminUserId,
      superAdminEmail: r.superAdmin?.email ?? null,
      accessedTenantId: r.accessedTenantId,
      route: r.route,
      method: r.method,
      params: r.params,
      reason: r.reason,
      createdAt: r.createdAt,
    }));

    const last = hasMore ? slice[slice.length - 1] : null;
    const nextCursor = last
      ? this.encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;

    return { items, nextCursor };
  }

  async listAdmins(): Promise<AdminSummary[]> {
    const grouped = await this.prisma.superAdminAccessLog.groupBy({
      by: ['superAdminUserId'],
      _count: { _all: true },
      _max: { createdAt: true },
    });
    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.superAdminUserId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u] as const));

    return grouped
      .map((g) => ({
        superAdminUserId: g.superAdminUserId,
        email: usersById.get(g.superAdminUserId)?.email ?? null,
        name: usersById.get(g.superAdminUserId)?.name ?? null,
        totalActions: g._count._all,
        lastActionAt: g._max.createdAt ?? null,
      }))
      .sort((a, b) => {
        const aTime = a.lastActionAt?.getTime() ?? 0;
        const bTime = b.lastActionAt?.getTime() ?? 0;
        return bTime - aTime;
      });
  }

  async stats(period: 'day' | 'week' | 'month'): Promise<AuditStats> {
    const to = new Date();
    const from = this.periodStart(to, period);

    const where: Prisma.SuperAdminAccessLogWhereInput = {
      createdAt: { gte: from, lt: to },
    };

    const [byRoute, byMethod, total] = await Promise.all([
      this.prisma.superAdminAccessLog.groupBy({
        by: ['route'],
        where,
        _count: { _all: true },
        orderBy: { _count: { route: 'desc' } },
        take: 50,
      }),
      this.prisma.superAdminAccessLog.groupBy({
        by: ['method'],
        where,
        _count: { _all: true },
      }),
      this.prisma.superAdminAccessLog.count({ where }),
    ]);

    return {
      period,
      from,
      to,
      totalActions: total,
      routes: byRoute.map((r) => ({ route: r.route, count: r._count._all })),
      methods: byMethod
        .map((m) => ({ method: m.method, count: m._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private periodStart(now: Date, period: 'day' | 'week' | 'month'): Date {
    const d = new Date(now);
    if (period === 'day') {
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    if (period === 'week') {
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    }
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d;
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  private decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf8');
      const data = JSON.parse(json) as { createdAt?: unknown; id?: unknown };
      if (typeof data.createdAt !== 'string' || typeof data.id !== 'string') {
        return null;
      }
      const dt = new Date(data.createdAt);
      if (Number.isNaN(dt.getTime())) return null;
      return { createdAt: data.createdAt, id: data.id };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), cursor },
        'AdminAuditService: некорректный cursor',
      );
      return null;
    }
  }
}
