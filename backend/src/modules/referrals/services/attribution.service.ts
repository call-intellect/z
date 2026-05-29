/**
 * AttributionService — атрибуция от лендинга к Org.
 *
 * Поток (ТЗ §9):
 *   1. Лендинг ставит cookie `z_ref=<slug>` (TTL 90 дней) + бьёт
 *      `POST /public/referrals/attribution { slug, fingerprint, referer, ip,
 *      userAgent }`. Создаётся `ReferralAttribution` с `expiresAt = now + 90d`.
 *   2. Юзер регистрирует Org → фронт зовёт
 *      `POST /api/v1/referrals/attribute-current-org` (auth-protected) сразу
 *      после signup. Сервис резолвит атрибуцию по cookie/fingerprint/ip и
 *      пишет в `Org.pendingAttributionSlug + pendingAttributionAt`.
 *   3. При первой реальной оплате (paid) `ReferralPayoutService.onInvoicePaid`
 *      создаёт `ClientReferralLink(firstPaidAt=now)` из этой pending-атрибуции.
 *
 * Идемпотентность:
 *   - `record()` НЕ дедуплицирует — каждый beacon-call создаёт новую запись
 *     (это нужно для аналитики «N касаний»). Резолв всегда берёт самую
 *     свежую запись по slug.
 *   - `attributeOrg()` идемпотентно: если у Org уже есть `pendingAttributionSlug`
 *     — обновляем (последняя атрибуция побеждает).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §9.
 */

import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const ATTRIBUTION_TTL_DAYS = 90;

/**
 * UTC YYYY-MM-DD для composite unique (audit-fixes §Б8). Сегодня по UTC,
 * чтобы один beacon = одна запись на партнёра+fingerprint в сутки.
 */
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
  /** Из cookie z_ref. Если есть — приоритет. */
  cookieSlug?: string | null;
  /** Fingerprint в качестве fallback (на случай если cookie блочится). */
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

  /**
   * Записать сырое касание лендинга. Возвращает идентификатор записи (не
   * критичен для фронта, но полезен для debugging'а).
   */
  async record(input: RecordAttributionInput): Promise<{ id: string }> {
    const referral = await this.prisma.referral.findUnique({
      where: { slug: input.slug.trim() },
      select: { id: true, slug: true },
    });
    if (!referral) {
      // Партнёр со slug'ом не найден — beacon бесмыслен. Не throw'им —
      // лендинг шлёт beacon в любом случае (даже на устаревший slug),
      // важно не падать. Логируем для дебага.
      this.logger.warn(
        `Beacon for unknown slug=${input.slug} — skip (без ReferralAttribution)`,
      );
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
      return { id: record.id };
    } catch (err) {
      // audit-fixes Б8: composite unique (referralId, fingerprint, dateBucket)
      // защищает от DoS-flood. P2002 = дубль за сегодня → возвращаем
      // существующую запись, не падаем (beacon идемпотентен).
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

  /**
   * После регистрации Org — резолвим атрибуцию и сохраняем slug в
   * `Org.pendingAttributionSlug`. Если ничего не нашли — no-op.
   *
   * Возвращает разрешённую атрибуцию (или null).
   */
  async attributeOrg(input: AttributeOrgInput): Promise<AttributionResolved | null> {
    const now = new Date();

    let attribution: { id: string; slug: string; referralId: string } | null = null;

    // 1. Cookie slug имеет приоритет.
    if (input.cookieSlug) {
      const slug = input.cookieSlug.trim();
      const found = await this.prisma.referralAttribution.findFirst({
        where: { slug, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, slug: true, referralId: true },
      });
      attribution = found ?? null;
    }

    // 2. Fallback на fingerprint (например, cookie заблокировал adblocker).
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

    // audit Б6 (2026-05-29): self-referral блокируется. Если владелец реферала
    // (Referral.ownerUserId) сам owner/member этой Org — атрибуция отклоняется.
    // Защита от схемы «создал Referral со своим slug → регаю Org → 20 000 ₽/мес.»
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

    await this.prisma.org.update({
      where: { id: input.tenantId },
      data: {
        pendingAttributionSlug: attribution.slug,
        pendingAttributionAt: now,
      },
    });
    this.logger.log(
      `attributeOrg ${input.tenantId} → ${attribution.slug} (referral=${attribution.referralId})`,
    );
    return {
      referralId: attribution.referralId,
      slug: attribution.slug,
      attributionId: attribution.id,
    };
  }

  /**
   * Резолв активной атрибуции по pendingAttributionSlug Org (используется
   * в ReferralPayoutService.onInvoicePaid). Возвращает referralId если
   * pending-slug всё ещё валиден (партнёр существует, slug активен).
   */
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

  /** Очистить pendingAttribution* после создания ClientReferralLink. */
  async clearPendingForOrg(tenantId: string): Promise<void> {
    await this.prisma.org.update({
      where: { id: tenantId },
      data: { pendingAttributionSlug: null, pendingAttributionAt: null },
    });
  }
}
