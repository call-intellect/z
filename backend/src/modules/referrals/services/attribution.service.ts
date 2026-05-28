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

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

const ATTRIBUTION_TTL_DAYS = 90;

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

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ATTRIBUTION_TTL_DAYS);

    const record = await this.prisma.referralAttribution.create({
      data: {
        referralId: referral.id,
        slug: referral.slug,
        fingerprint: input.fingerprint?.slice(0, 64) ?? null,
        ip: input.ip?.slice(0, 45) ?? null,
        userAgent: input.userAgent?.slice(0, 2000) ?? null,
        referer: input.referer?.slice(0, 2000) ?? null,
        expiresAt,
      },
    });
    return { id: record.id };
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
