import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

const ATTRIBUTION_TTL_DAYS = 90;

function dateBucketUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface RecordAttributionInput {
  slug: string;
  fingerprint?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
}

export interface AttributeOrgInput {
  tenantId: string;
  cookieSlug?: string | null;
  fingerprint?: string | null;
  ip?: string | null;
}

export interface AttributionResolved {
  referralId: string;
  slug: string;
  attributionId: string;
}

@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async record(input: RecordAttributionInput): Promise<{ id: string }> {
    const referral = await this.prisma.referral.findUnique({
      where: { slug: input.slug.trim() },
      select: { id: true, slug: true },
    });
    if (!referral) {
      this.logger.warn(`Beacon for unknown slug=${input.slug} — skip (без ReferralAttribution)`);
      return { id: 'skipped' };
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + ATTRIBUTION_TTL_DAYS);
    const dateBucket = dateBucketUtc(now);
    const fingerprint = input.fingerprint?.slice(0, 64) ?? null;

    try {
      const record = await this.prisma.referralAttribution.create({
        data: {
          referralId: referral.id,
          slug: referral.slug,
          fingerprint,
          ip: input.ip?.slice(0, 45) ?? null,
          userAgent: input.userAgent?.slice(0, 2000) ?? null,
          referer: input.referer?.slice(0, 2000) ?? null,
          expiresAt,
          dateBucket,
        },
      });
      this.metrics.incReferralClick({ partnerTop: tenantTopOf(referral.slug) });
      return { id: record.id };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        fingerprint !== null
      ) {
        const existing = await this.prisma.referralAttribution.findFirst({
          where: { referralId: referral.id, fingerprint, dateBucket },
          select: { id: true },
        });
        if (existing) {
          this.logger.debug(
            `Beacon dedup для referral=${referral.id} fp=${fingerprint.slice(0, 8)}… date=${dateBucket}`,
          );
          return { id: existing.id };
        }
      }
      throw err;
    }
  }

  async attributeOrg(input: AttributeOrgInput): Promise<AttributionResolved | null> {
    const now = new Date();

    let attribution: { id: string; slug: string; referralId: string } | null = null;

    if (input.cookieSlug) {
      const slug = input.cookieSlug.trim();
      const found = await this.prisma.referralAttribution.findFirst({
        where: { slug, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, slug: true, referralId: true },
      });
      attribution = found ?? null;
    }

    if (!attribution && input.fingerprint) {
      const found = await this.prisma.referralAttribution.findFirst({
        where: {
          fingerprint: input.fingerprint.slice(0, 64),
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, slug: true, referralId: true },
      });
      attribution = found ?? null;
    }

    if (!attribution) {
      this.logger.log(`attributeOrg ${input.tenantId}: атрибуция не найдена`);
      return null;
    }

    const referralOwner = await this.prisma.referral.findUnique({
      where: { id: attribution.referralId },
      select: { ownerUserId: true, slug: true },
    });
    if (referralOwner) {
      const selfMembership = await this.prisma.membership.findUnique({
        where: {
          orgId_userId: {
            orgId: input.tenantId,
            userId: referralOwner.ownerUserId,
          },
        },
        select: { role: true },
      });
      if (selfMembership) {
        this.metrics.incReferralSelfReferralDenied();
        this.logger.warn(
          `attributeOrg ${input.tenantId}: self-referral отклонён (slug=${referralOwner.slug}, ownerUserId=${referralOwner.ownerUserId}, role=${selfMembership.role})`,
        );
        throw new ConflictException({
          ok: false,
          error: {
            code: 'self_referral_denied',
            message:
              'Нельзя привязать собственный реферальный slug к компании, в которой вы являетесь участником.',
          },
        });
      }
    }

    const result = await this.prisma.org.updateMany({
      where: { id: input.tenantId, pendingAttributionSlug: null },
      data: {
        pendingAttributionSlug: attribution.slug,
        pendingAttributionAt: now,
      },
    });

    if (result.count === 0) {
      this.metrics.incReferralAttributionFirstTouchLocked();
      const existing = await this.resolvePendingForOrg(input.tenantId);
      this.logger.log(
        `attributeOrg ${input.tenantId}: first-touch уже зафиксирован, ` +
          `повторный клик по slug=${attribution.slug} проигнорирован ` +
          `(текущий slug=${existing?.slug ?? 'unknown'})`,
      );
      return existing
        ? { referralId: existing.referralId, slug: existing.slug, attributionId: '' }
        : null;
    }

    this.metrics.incReferralSignup({ partnerTop: tenantTopOf(attribution.slug) });
    this.logger.log(
      `attributeOrg ${input.tenantId} → ${attribution.slug} (referral=${attribution.referralId})`,
    );
    return {
      referralId: attribution.referralId,
      slug: attribution.slug,
      attributionId: attribution.id,
    };
  }

  async resolvePendingForOrg(tenantId: string): Promise<{
    referralId: string;
    slug: string;
    pendingAttributionAt: Date;
  } | null> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { pendingAttributionSlug: true, pendingAttributionAt: true },
    });
    if (!org?.pendingAttributionSlug || !org.pendingAttributionAt) return null;
    const referral = await this.prisma.referral.findUnique({
      where: { slug: org.pendingAttributionSlug },
      select: { id: true, slug: true },
    });
    if (!referral) return null;
    return {
      referralId: referral.id,
      slug: referral.slug,
      pendingAttributionAt: org.pendingAttributionAt,
    };
  }

  async clearPendingForOrg(tenantId: string): Promise<void> {
    await this.prisma.org.update({
      where: { id: tenantId },
      data: { pendingAttributionSlug: null, pendingAttributionAt: null },
    });
  }
}
