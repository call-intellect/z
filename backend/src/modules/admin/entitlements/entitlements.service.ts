import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface EntitlementOverviewItem {
  tenantId: string;
  orgName: string;
  orgSlug: string;
  tier: string;
  featureOverridesKeys: number;
  quotaOverridesKeys: number;
  notes: string | null;
  updatedAt: Date;
}

export interface EntitlementOverviewResult {
  items: EntitlementOverviewItem[];
  nextCursor: string | null;
}

export interface ResolvedEntitlements {
  tenantId: string;
  tier: string;
  plan: {
    id: string;
    displayName: string;
    isActive: boolean;
    features: Record<string, unknown>;
    quotas: Record<string, unknown>;
  } | null;
  features: Record<string, unknown>;
  quotas: Record<string, unknown>;
  featureOverrides: Record<string, unknown>;
  quotaOverrides: Record<string, unknown>;
  notes: string | null;
}

interface CursorPayload {
  updatedAt: string;
  id: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function countKeys(v: unknown): number {
  return isPlainObject(v) ? Object.keys(v).length : 0;
}

function toObject(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? { ...v } : {};
}

@Injectable()
export class AdminEntitlementsService {
  private readonly logger = new Logger(AdminEntitlementsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listOverview(filters: {
    hasOverrides: boolean;
    plan?: string;
    cursor?: string;
    limit: number;
  }): Promise<EntitlementOverviewResult> {
    const where: Prisma.OrgEntitlementWhereInput = {};
    if (filters.plan) where.tier = filters.plan;

    const decoded = filters.cursor ? this.decodeCursor(filters.cursor) : null;
    if (decoded) {
      const cursorDate = new Date(decoded.updatedAt);
      const orConditions: Prisma.OrgEntitlementWhereInput[] = [
        { updatedAt: { lt: cursorDate } },
        { updatedAt: cursorDate, id: { lt: decoded.id } },
      ];
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: orConditions }];
    }

    const takeRaw = filters.hasOverrides ? Math.min(filters.limit * 4, 500) : filters.limit + 1;
    const rows = await this.prisma.orgEntitlement.findMany({
      where,
      take: takeRaw,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        org: { select: { id: true, name: true, slug: true } },
      },
    });

    const filtered = filters.hasOverrides
      ? rows.filter((r) => countKeys(r.featureOverrides) > 0 || countKeys(r.quotaOverrides) > 0)
      : rows;

    const hasMore = filtered.length > filters.limit;
    const slice = hasMore ? filtered.slice(0, filters.limit) : filtered;

    const items: EntitlementOverviewItem[] = slice
      .filter((r) => r.org !== null)
      .map((r) => ({
        tenantId: r.tenantId,
        orgName: r.org!.name,
        orgSlug: r.org!.slug,
        tier: r.tier,
        featureOverridesKeys: countKeys(r.featureOverrides),
        quotaOverridesKeys: countKeys(r.quotaOverrides),
        notes: r.notes,
        updatedAt: r.updatedAt,
      }));

    const last = hasMore ? slice[slice.length - 1] : null;
    const nextCursor = last
      ? this.encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
      : null;

    return { items, nextCursor };
  }

  async upsertForOrg(
    orgId: string,
    input: {
      tier?: string;
      featureOverrides?: Record<string, unknown> | null;
      quotaOverrides?: Record<string, unknown> | null;
      notes?: string | null;
    },
  ): Promise<{ ok: true; tenantId: string; tier: string }> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: `Org id="${orgId}" не найдена` },
      });
    }

    const createData: Prisma.OrgEntitlementCreateInput = {
      org: { connect: { id: orgId } },
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.featureOverrides !== undefined
        ? {
            featureOverrides:
              input.featureOverrides === null
                ? Prisma.JsonNull
                : (input.featureOverrides as Prisma.InputJsonValue),
          }
        : {}),
      ...(input.quotaOverrides !== undefined
        ? {
            quotaOverrides:
              input.quotaOverrides === null
                ? Prisma.JsonNull
                : (input.quotaOverrides as Prisma.InputJsonValue),
          }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    const updateData: Prisma.OrgEntitlementUpdateInput = {};
    if (input.tier !== undefined) updateData.tier = input.tier;
    if (input.featureOverrides !== undefined) {
      updateData.featureOverrides =
        input.featureOverrides === null
          ? Prisma.JsonNull
          : (input.featureOverrides as Prisma.InputJsonValue);
    }
    if (input.quotaOverrides !== undefined) {
      updateData.quotaOverrides =
        input.quotaOverrides === null
          ? Prisma.JsonNull
          : (input.quotaOverrides as Prisma.InputJsonValue);
    }
    if (input.notes !== undefined) updateData.notes = input.notes;

    const ent = await this.prisma.orgEntitlement.upsert({
      where: { tenantId: orgId },
      create: createData,
      update: updateData,
    });
    this.logger.log(
      `AdminEntitlementsService: upsert OrgEntitlement tenantId=${orgId} tier=${ent.tier}`,
    );
    return { ok: true, tenantId: ent.tenantId, tier: ent.tier };
  }

  async removeFeatureKey(orgId: string, key: string): Promise<{ ok: true; removed: boolean }> {
    return this.removeKey(orgId, 'featureOverrides', key);
  }

  async removeQuotaKey(orgId: string, key: string): Promise<{ ok: true; removed: boolean }> {
    return this.removeKey(orgId, 'quotaOverrides', key);
  }

  async resolveForOrg(orgId: string): Promise<ResolvedEntitlements> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: `Org id="${orgId}" не найдена` },
      });
    }
    const ent = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId: orgId },
    });
    const tier = ent?.tier ?? 'tier_pro';
    const plan = await this.prisma.plan.findUnique({ where: { id: tier } });

    const planFeatures = plan ? toObject(plan.features) : {};
    const planQuotas = plan ? toObject(plan.quotas) : {};
    const featureOverrides = ent ? toObject(ent.featureOverrides) : {};
    const quotaOverrides = ent ? toObject(ent.quotaOverrides) : {};

    return {
      tenantId: orgId,
      tier,
      plan: plan
        ? {
            id: plan.id,
            displayName: plan.displayName,
            isActive: plan.isActive,
            features: planFeatures,
            quotas: planQuotas,
          }
        : null,
      features: { ...planFeatures, ...featureOverrides },
      quotas: { ...planQuotas, ...quotaOverrides },
      featureOverrides,
      quotaOverrides,
      notes: ent?.notes ?? null,
    };
  }

  private async removeKey(
    orgId: string,
    field: 'featureOverrides' | 'quotaOverrides',
    key: string,
  ): Promise<{ ok: true; removed: boolean }> {
    const ent = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId: orgId },
    });
    if (!ent) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'entitlement_not_found',
          message: `OrgEntitlement для tenantId="${orgId}" не найден`,
        },
      });
    }
    const current = toObject(ent[field]);
    if (!(key in current)) {
      return { ok: true, removed: false };
    }
    delete current[key];

    await this.prisma.orgEntitlement.update({
      where: { tenantId: orgId },
      data: {
        [field]:
          Object.keys(current).length === 0 ? Prisma.JsonNull : (current as Prisma.InputJsonValue),
      },
    });
    return { ok: true, removed: true };
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  private decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64').toString('utf8');
      const data = JSON.parse(json) as { updatedAt?: unknown; id?: unknown };
      if (typeof data.updatedAt !== 'string' || typeof data.id !== 'string') {
        return null;
      }
      const dt = new Date(data.updatedAt);
      if (Number.isNaN(dt.getTime())) return null;
      return { updatedAt: data.updatedAt, id: data.id };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), cursor },
        'AdminEntitlementsService: некорректный cursor',
      );
      return null;
    }
  }
}
