import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type OrgTier, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminPeriod } from '../dto/admin-usage.dto';

import { periodToRange } from './admin-usage.service';

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  ownerId: string;
  ownerEmail: string | null;
  membersCount: number;
  meetingsCount: number;
  costUsdInPeriod: number;
  callsInPeriod: number;
  deletedAt: string | null;
  createdAt: string;
}

/** Admin-redesign Фаза 4 — карточки вкладок страницы `/admin/orgs/[id]`. */

export interface OrgOverview {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  createdAt: Date;
  ownerEmail: string | null;
  membersCount: number;
  meetingsCount: number;
  /** Сумма costUsd за последние 30 дней (по AiUsageLog). */
  totalSpendUsd: number;
  /** Заполнено `totalRevenueRub`, если есть Plan + monthlyPriceRub. */
  totalRevenueRub: number | null;
  isFrozen: boolean;
}

export interface OrgMemberItem {
  userId: string;
  email: string | null;
  name: string;
  role: string;
  joinedAt: Date;
  lastSeenAt: Date | null;
}

export interface OrgSourceItem {
  /** "channel" | "webhook_subscription". */
  kind: string;
  /** Технический тип (telegram_bot/email_smtp/url/...). */
  type: string;
  id: string;
  status: string;
  createdAt: Date;
}

export interface OrgAuditItem {
  id: string;
  superAdminUserId: string;
  superAdminEmail: string | null;
  route: string;
  method: string;
  reason: string | null;
  createdAt: Date;
}

interface OrgAuditCursorPayload {
  createdAt: string;
  id: string;
}

interface OrgMembersCursorPayload {
  joinedAt: string;
  id: string;
}

/**
 * AdminOrgsService (Z-Admin Фаза 7 шаг 6).
 *
 *   - listOrgs({period, search?, limit}): Org + counts + cost за период.
 *   - updateOrg(id, {tier?, freeze?}): tier / freeze (deletedAt = now).
 *   - deleteOrg(id): soft-delete (deletedAt = now). Cascade — vNext.
 *
 * NB: cursor-pagination по Org опущен — Org обычно <100. Простой `take=limit`.
 * Если в production вырастет — добавить.
 */
@Injectable()
export class AdminOrgsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listOrgs(args: {
    period: AdminPeriod;
    from?: Date;
    to?: Date;
    search?: string;
    limit: number;
    includeDeleted: boolean;
  }): Promise<{ items: AdminOrgRow[] }> {
    const range = periodToRange(args);
    const where: Prisma.OrgWhereInput = {};
    if (!args.includeDeleted) where.deletedAt = null;
    if (args.search) {
      where.OR = [
        { name: { contains: args.search, mode: 'insensitive' } },
        { slug: { contains: args.search, mode: 'insensitive' } },
      ];
    }

    const orgs = await this.prisma.org.findMany({
      where,
      take: args.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { email: true } },
        _count: { select: { memberships: true, meetings: true } },
      },
    });
    if (orgs.length === 0) return { items: [] };

    const orgIds = orgs.map((o) => o.id);
    // Cost / call count за период по каждой Org.
    const usage = await this.prisma.aiUsageLog.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: orgIds },
        createdAt: { gte: range.gte, lt: range.lt },
      },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    const usageById = new Map(
      usage.map((u) => [
        u.tenantId ?? '',
        {
          cost: decimalToNumber(u._sum.costUsd),
          calls: u._count._all,
        },
      ]),
    );

    const items: AdminOrgRow[] = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      tier: o.tier,
      ownerId: o.ownerId,
      ownerEmail: o.owner?.email ?? null,
      membersCount: o._count.memberships,
      meetingsCount: o._count.meetings,
      costUsdInPeriod: usageById.get(o.id)?.cost ?? 0,
      callsInPeriod: usageById.get(o.id)?.calls ?? 0,
      deletedAt: o.deletedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    }));
    return { items };
  }

  async updateOrg(
    orgId: string,
    args: { tier?: OrgTier; freeze?: boolean },
  ): Promise<{ ok: true }> {
    const data: Prisma.OrgUpdateInput = {};
    if (args.tier !== undefined) data.tier = args.tier;
    if (args.freeze === true) data.deletedAt = new Date();
    if (args.freeze === false) data.deletedAt = null;
    if (Object.keys(data).length === 0) return { ok: true };
    await this.prisma.org.update({ where: { id: orgId }, data });
    return { ok: true };
  }

  async deleteOrg(orgId: string): Promise<{ ok: true }> {
    await this.prisma.org.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ─────────────────────────── Admin-redesign Фаза 4 ───────────────────────
  //
  // Вкладки страницы `/admin/orgs/[id]`: overview / members / sources / audit.
  // Каждая вкладка — отдельный GET-эндпоинт, чтобы UI грузил их параллельно.

  async getOrgOverview(orgId: string): Promise<OrgOverview> {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      include: {
        owner: { select: { email: true } },
        _count: { select: { memberships: true, meetings: true } },
      },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: `Org id="${orgId}" не найдена` },
      });
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const usage = await this.prisma.aiUsageLog.aggregate({
      where: { tenantId: orgId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    });
    const totalSpendUsd = decimalToNumber(usage._sum.costUsd);

    // totalRevenueRub: если активная Plan + monthlyPriceRub → берём цену плана.
    // Иначе null (бесплатный тариф или Plan без цены).
    let totalRevenueRub: number | null = null;
    const ent = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId: orgId },
      select: { tier: true },
    });
    const tier = ent?.tier ?? null;
    if (tier) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: tier },
        select: { monthlyPriceRub: true },
      });
      if (plan?.monthlyPriceRub !== undefined && plan?.monthlyPriceRub !== null) {
        totalRevenueRub = plan.monthlyPriceRub;
      }
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      tier: org.tier,
      createdAt: org.createdAt,
      ownerEmail: org.owner?.email ?? null,
      membersCount: org._count.memberships,
      meetingsCount: org._count.meetings,
      totalSpendUsd,
      totalRevenueRub,
      isFrozen: org.deletedAt !== null,
    };
  }

  async getOrgMembers(
    orgId: string,
    args: { cursor?: string; limit: number },
  ): Promise<{ items: OrgMemberItem[]; nextCursor: string | null }> {
    const where: Prisma.MembershipWhereInput = { orgId };
    const decoded = args.cursor ? this.decodeMembersCursor(args.cursor) : null;
    if (decoded) {
      const cursorDate = new Date(decoded.joinedAt);
      const orConditions: Prisma.MembershipWhereInput[] = [
        { joinedAt: { lt: cursorDate } },
        { joinedAt: cursorDate, id: { lt: decoded.id } },
      ];
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { OR: orConditions },
      ];
    }

    const rows = await this.prisma.membership.findMany({
      where,
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
      include: {
        user: {
          select: { id: true, email: true, name: true, lastSeenAt: true },
        },
      },
    });
    const hasMore = rows.length > args.limit;
    const slice = hasMore ? rows.slice(0, args.limit) : rows;
    const items: OrgMemberItem[] = slice.map((r) => ({
      userId: r.userId,
      email: r.user?.email ?? null,
      name: r.user?.name ?? '',
      role: r.role,
      joinedAt: r.joinedAt,
      lastSeenAt: r.user?.lastSeenAt ?? null,
    }));
    const last = hasMore ? slice[slice.length - 1] : null;
    const nextCursor = last
      ? this.encodeMembersCursor({
          joinedAt: last.joinedAt.toISOString(),
          id: last.id,
        })
      : null;
    return { items, nextCursor };
  }

  async getOrgSources(orgId: string): Promise<{ items: OrgSourceItem[] }> {
    const [channels, webhooks] = await Promise.all([
      this.prisma.channel.findMany({
        where: { tenantId: orgId },
        select: {
          id: true,
          kind: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.webhookSubscription.findMany({
        where: { tenantId: orgId },
        select: {
          id: true,
          url: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const items: OrgSourceItem[] = [
      ...channels.map((c) => ({
        kind: 'channel',
        type: c.kind as string,
        id: c.id,
        status: c.status as string,
        createdAt: c.createdAt,
      })),
      ...webhooks.map((w) => ({
        kind: 'webhook_subscription',
        type: 'url',
        id: w.id,
        status: w.status as string,
        createdAt: w.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items };
  }

  async getOrgAudit(
    orgId: string,
    args: { cursor?: string; limit: number },
  ): Promise<{ items: OrgAuditItem[]; nextCursor: string | null }> {
    const where: Prisma.SuperAdminAccessLogWhereInput = { accessedTenantId: orgId };
    const decoded = args.cursor ? this.decodeAuditCursor(args.cursor) : null;
    if (decoded) {
      const cursorDate = new Date(decoded.createdAt);
      const orConditions: Prisma.SuperAdminAccessLogWhereInput[] = [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: decoded.id } },
      ];
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        { OR: orConditions },
      ];
    }

    const rows = await this.prisma.superAdminAccessLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
      include: { superAdmin: { select: { email: true } } },
    });
    const hasMore = rows.length > args.limit;
    const slice = hasMore ? rows.slice(0, args.limit) : rows;
    const items: OrgAuditItem[] = slice.map((r) => ({
      id: r.id,
      superAdminUserId: r.superAdminUserId,
      superAdminEmail: r.superAdmin?.email ?? null,
      route: r.route,
      method: r.method,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
    const last = hasMore ? slice[slice.length - 1] : null;
    const nextCursor = last
      ? this.encodeAuditCursor({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;
    return { items, nextCursor };
  }

  // ─────────────────────────── private cursor helpers ─────────────────────

  private encodeAuditCursor(p: OrgAuditCursorPayload): string {
    return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
  }

  private decodeAuditCursor(cursor: string): OrgAuditCursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf8');
      const data = JSON.parse(json) as { createdAt?: unknown; id?: unknown };
      if (typeof data.createdAt !== 'string' || typeof data.id !== 'string') return null;
      if (Number.isNaN(new Date(data.createdAt).getTime())) return null;
      return { createdAt: data.createdAt, id: data.id };
    } catch {
      return null;
    }
  }

  private encodeMembersCursor(p: OrgMembersCursorPayload): string {
    return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
  }

  private decodeMembersCursor(cursor: string): OrgMembersCursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf8');
      const data = JSON.parse(json) as { joinedAt?: unknown; id?: unknown };
      if (typeof data.joinedAt !== 'string' || typeof data.id !== 'string') return null;
      if (Number.isNaN(new Date(data.joinedAt).getTime())) return null;
      return { joinedAt: data.joinedAt, id: data.id };
    } catch {
      return null;
    }
  }
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof (v as unknown as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return (v as unknown as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  return Number(v) || 0;
}
