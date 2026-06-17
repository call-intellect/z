import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { SeatService } from '../../billing/services/seat.service';
import { TIER_CONFIG } from '../../entitlements/tier-config';
import { AdminSettingsService } from '../settings/admin-settings.service';

import type { PlanSnapshot } from './dto/plan-snapshot.dto';

const TIER_STANDARD_DISPLAY_NAME = 'Стандартный';
const TIER_STANDARD_DESCRIPTION = 'Единый тариф Z. Все фичи Z.';

const LEGACY_TIERS = ['tier_basic', 'tier_pro', 'tier_enterprise'] as const;

const DEFAULT_BASE_MONTHLY_KOPECKS = 6_000_000;
const DEFAULT_PER_EXTRA_SEAT_KOPECKS = 100_000;
const DEFAULT_YEARLY_DISCOUNT_RATE = 0.8;
const DEFAULT_BASE_SEATS_INCLUDED = 31;
const DEFAULT_BASE_MEETINGS_GRANT = 150;
const DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT = 5;

function readNumberSetting(
  bag: Record<string, unknown>,
  key: string,
  fallback: number,
  logger: Logger,
): number {
  const v = bag[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  logger.warn(
    `AdminPlansService: AdminSetting ${key} имеет неверный тип (${typeof v}), используем code-fallback ${fallback}`,
  );
  return fallback;
}

@Injectable()
export class AdminPlansService {
  private readonly logger = new Logger(AdminPlansService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminSettingsService) private readonly adminSettings: AdminSettingsService,
    @Inject(SeatService) private readonly seat: SeatService,
  ) {}

  async getCurrentSnapshot(): Promise<PlanSnapshot> {
    const settings = await this.adminSettings.getMany([
      'billing.baseMonthlyKopecks',
      'billing.perExtraSeatKopecks',
      'billing.yearlyDiscountRate',
      'billing.baseSeatsIncluded',
      'billing.baseMeetingsGrant',
      'billing.perExtraSeatMeetingsGrant',
    ]);

    const baseMonthlyKopecks = readNumberSetting(
      settings,
      'billing.baseMonthlyKopecks',
      DEFAULT_BASE_MONTHLY_KOPECKS,
      this.logger,
    );
    const perExtraSeatKopecks = readNumberSetting(
      settings,
      'billing.perExtraSeatKopecks',
      DEFAULT_PER_EXTRA_SEAT_KOPECKS,
      this.logger,
    );
    const yearlyDiscountRate = readNumberSetting(
      settings,
      'billing.yearlyDiscountRate',
      DEFAULT_YEARLY_DISCOUNT_RATE,
      this.logger,
    );
    const baseSeatsIncluded = readNumberSetting(
      settings,
      'billing.baseSeatsIncluded',
      DEFAULT_BASE_SEATS_INCLUDED,
      this.logger,
    );
    const baseMeetingsGrant = readNumberSetting(
      settings,
      'billing.baseMeetingsGrant',
      DEFAULT_BASE_MEETINGS_GRANT,
      this.logger,
    );
    const perExtraSeatMeetingsGrant = readNumberSetting(
      settings,
      'billing.perExtraSeatMeetingsGrant',
      DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT,
      this.logger,
    );

    const [pricing, orgsUsingCount, legacyOrgsRemainingCount] = await Promise.all([
      this.seat.calculatePricing('monthly', 0),
      this.prisma.orgEntitlement.count({ where: { tier: 'tier_standard' } }),
      this.prisma.orgEntitlement.count({
        where: { tier: { in: [...LEGACY_TIERS] } },
      }),
    ]);

    const tier = TIER_CONFIG['tier_standard'];

    const discountPercent = Math.round((1 - yearlyDiscountRate) * 100);
    const monthlyEquivalentKopecks = Math.round(baseMonthlyKopecks * yearlyDiscountRate);
    const fullYearKopecks = monthlyEquivalentKopecks * 12;

    return {
      tier: 'tier_standard',
      displayName: TIER_STANDARD_DISPLAY_NAME,
      description: TIER_STANDARD_DESCRIPTION,
      base: {
        monthlyPriceRub: Math.round(pricing.monthlyKopecks / 100),
        monthlyPriceKopecks: pricing.monthlyKopecks,
        seatsIncluded: baseSeatsIncluded,
        meetingsIncludedPerMonth: baseMeetingsGrant,
      },
      extraSeat: {
        monthlyPriceRubPerSeat: Math.round(perExtraSeatKopecks / 100),
        monthlyPriceKopecksPerSeat: perExtraSeatKopecks,
        meetingsPerSeat: perExtraSeatMeetingsGrant,
      },
      yearly: {
        discountPercent,
        monthlyEquivalentRub: Math.round(monthlyEquivalentKopecks / 100),
        fullYearRub: Math.round(fullYearKopecks / 100),
      },
      features: tier.features as Record<string, boolean>,
      quotas: tier.quotas as Record<string, number>,
      orgsUsingCount,
      legacyOrgsRemainingCount,
      editableSettings: [
        {
          key: 'billing.baseMonthlyKopecks',
          currentValue: baseMonthlyKopecks,
          severity: 'high',
        },
        {
          key: 'billing.perExtraSeatKopecks',
          currentValue: perExtraSeatKopecks,
          severity: 'high',
        },
        {
          key: 'billing.yearlyDiscountRate',
          currentValue: yearlyDiscountRate,
          severity: 'high',
        },
        {
          key: 'billing.baseSeatsIncluded',
          currentValue: baseSeatsIncluded,
          severity: 'high',
        },
        {
          key: 'billing.baseMeetingsGrant',
          currentValue: baseMeetingsGrant,
          severity: 'high',
        },
        {
          key: 'billing.perExtraSeatMeetingsGrant',
          currentValue: perExtraSeatMeetingsGrant,
          severity: 'high',
        },
      ],
    };
  }
}
