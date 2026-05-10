import { Inject, Injectable } from '@nestjs/common';
import { type OrgTier, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { periodToRange } from './admin-usage.service';
import type { AdminPeriod } from '../dto/admin-usage.dto';

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
