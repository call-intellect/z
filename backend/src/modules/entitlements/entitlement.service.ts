import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';

import {
  ALL_FEATURES,
  ALL_QUOTAS,
  type FeatureKey,
  type QuotaKey,
  TIER_CONFIG,
  type TierKey,
  isFeatureKey,
  isQuotaKey,
  isTierKey,
} from './tier-config';

export interface ResolvedEntitlement {
  tier: TierKey;
  features: Record<FeatureKey, boolean>;
  quotas: Record<QuotaKey, number>;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides: Partial<Record<QuotaKey, number>>;
  notes: string | null;
  rawTier: string;
  failedSafe: boolean;
}

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  private static readonly CACHE_TTL_SECONDS = 300;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async getEntitlement(tenantId: string): Promise<ResolvedEntitlement> {
    const cacheKey = this.cacheKey(tenantId);

    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as ResolvedEntitlement;
        return parsed;
      }
    } catch (err) {
      this.logger.warn(
        `EntitlementService.getEntitlement cache read fail для ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const record = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId },
    });

    let resolved: ResolvedEntitlement;
    if (!record) {
      this.logger.warn(
        `EntitlementService.getEntitlement: запись OrgEntitlement отсутствует для tenantId=${tenantId}, fail-safe → tier_standard`,
      );
      resolved = this.buildFailSafe(null, null, null);
    } else {
      resolved = this.resolveFromDb(
        record.tier,
        record.featureOverrides,
        record.quotaOverrides,
        record.notes,
      );
    }

    try {
      await this.redis.client.set(
        cacheKey,
        JSON.stringify(resolved),
        'EX',
        EntitlementService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `EntitlementService.getEntitlement cache write fail для ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return resolved;
  }

  async hasFeature(tenantId: string, feature: FeatureKey): Promise<boolean> {
    const ent = await this.getEntitlement(tenantId);
    return ent.features[feature] === true;
  }

  async getQuota(tenantId: string, quota: QuotaKey): Promise<number> {
    const ent = await this.getEntitlement(tenantId);
    const v = ent.quotas[quota];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  }

  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.redis.client.del(this.cacheKey(tenantId));
    } catch (err) {
      this.logger.warn(
        `EntitlementService.invalidate fail для ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async setTier(
    tenantId: string,
    tier: TierKey,
    byUserId: string | null,
    reason: string,
  ): Promise<void> {
    const before = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId },
      select: { tier: true },
    });

    await this.prisma.orgEntitlement.upsert({
      where: { tenantId },
      create: { tenantId, tier },
      update: { tier },
    });

    await this.invalidate(tenantId);

    void this.audit.log({
      userId: byUserId,
      action: AUDIT.TIER_CHANGED,
      resourceId: tenantId,
      metadata: {
        tenantId,
        before: before?.tier ?? null,
        after: tier,
        reason,
      },
    });
  }

  async setNotes(tenantId: string, notes: string | null): Promise<void> {
    await this.prisma.orgEntitlement.upsert({
      where: { tenantId },
      create: { tenantId, notes },
      update: { notes },
    });
    await this.invalidate(tenantId);
  }

  async setOverride(
    tenantId: string,
    kind: 'feature' | 'quota',
    key: string,
    value: boolean | number | null,
    byUserId: string | null,
    reason: string,
  ): Promise<void> {
    if (kind === 'feature') {
      if (!isFeatureKey(key)) {
        throw new Error(`setOverride: unknown FeatureKey '${key}'`);
      }
      if (value !== null && typeof value !== 'boolean') {
        throw new Error(`setOverride: feature override value must be boolean | null`);
      }
    } else {
      if (!isQuotaKey(key)) {
        throw new Error(`setOverride: unknown QuotaKey '${key}'`);
      }
      if (value !== null && typeof value !== 'number') {
        throw new Error(`setOverride: quota override value must be number | null`);
      }
    }

    const existing = await this.prisma.orgEntitlement.findUnique({
      where: { tenantId },
    });

    const featureOverrides = this.toRecord(existing?.featureOverrides);
    const quotaOverrides = this.toRecord(existing?.quotaOverrides);

    if (kind === 'feature') {
      if (value === null) delete featureOverrides[key];
      else featureOverrides[key] = value;
    } else {
      if (value === null) delete quotaOverrides[key];
      else quotaOverrides[key] = value;
    }

    const featureOverridesJson =
      Object.keys(featureOverrides).length > 0
        ? (featureOverrides as Prisma.InputJsonValue)
        : Prisma.DbNull;
    const quotaOverridesJson =
      Object.keys(quotaOverrides).length > 0
        ? (quotaOverrides as Prisma.InputJsonValue)
        : Prisma.DbNull;

    await this.prisma.orgEntitlement.upsert({
      where: { tenantId },
      create: {
        tenantId,
        featureOverrides: featureOverridesJson === Prisma.DbNull ? undefined : featureOverridesJson,
        quotaOverrides: quotaOverridesJson === Prisma.DbNull ? undefined : quotaOverridesJson,
      },
      update: {
        featureOverrides: featureOverridesJson,
        quotaOverrides: quotaOverridesJson,
      },
    });

    await this.invalidate(tenantId);

    void this.audit.log({
      userId: byUserId,
      action: AUDIT.ENTITLEMENT_OVERRIDE_SET,
      resourceId: tenantId,
      metadata: {
        tenantId,
        kind,
        key,
        value,
        reason,
      },
    });
  }

  private cacheKey(tenantId: string): string {
    return `entitlement:${tenantId}`;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }
    return {};
  }

  private resolveFromDb(
    rawTier: string,
    featureOverridesRaw: unknown,
    quotaOverridesRaw: unknown,
    notes: string | null,
  ): ResolvedEntitlement {
    const featureOverrides = this.normalizeFeatureOverrides(featureOverridesRaw);
    const quotaOverrides = this.normalizeQuotaOverrides(quotaOverridesRaw);

    if (!isTierKey(rawTier)) {
      this.logger.warn(
        `EntitlementService: unknown tier '${rawTier}' in DB, fail-safe → tier_standard`,
      );
      return this.buildFailSafe(rawTier, featureOverrides, quotaOverrides, notes);
    }

    const tier = rawTier;
    const baseFeatures = TIER_CONFIG[tier].features;
    const baseQuotas = TIER_CONFIG[tier].quotas;

    const features = { ...baseFeatures };
    for (const f of ALL_FEATURES) {
      if (Object.prototype.hasOwnProperty.call(featureOverrides, f)) {
        const v = featureOverrides[f];
        if (typeof v === 'boolean') features[f] = v;
      }
    }

    const quotas = { ...baseQuotas };
    for (const q of ALL_QUOTAS) {
      if (Object.prototype.hasOwnProperty.call(quotaOverrides, q)) {
        const v = quotaOverrides[q];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) quotas[q] = v;
      }
    }

    return {
      tier,
      features,
      quotas,
      featureOverrides,
      quotaOverrides,
      notes,
      rawTier,
      failedSafe: false,
    };
  }

  private buildFailSafe(
    rawTier: string | null,
    featureOverrides: Partial<Record<FeatureKey, boolean>> | null,
    quotaOverrides: Partial<Record<QuotaKey, number>> | null,
    notes: string | null = null,
  ): ResolvedEntitlement {
    return {
      tier: 'tier_standard',
      features: { ...TIER_CONFIG.tier_standard.features },
      quotas: { ...TIER_CONFIG.tier_standard.quotas },
      featureOverrides: featureOverrides ?? {},
      quotaOverrides: quotaOverrides ?? {},
      notes,
      rawTier: rawTier ?? 'tier_standard',
      failedSafe: true,
    };
  }

  private normalizeFeatureOverrides(raw: unknown): Partial<Record<FeatureKey, boolean>> {
    const out: Partial<Record<FeatureKey, boolean>> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isFeatureKey(k) && typeof v === 'boolean') out[k] = v;
    }
    return out;
  }

  private normalizeQuotaOverrides(raw: unknown): Partial<Record<QuotaKey, number>> {
    const out: Partial<Record<QuotaKey, number>> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isQuotaKey(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[k] = v;
      }
    }
    return out;
  }
}
