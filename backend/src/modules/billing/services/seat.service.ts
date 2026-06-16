import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config';
import { MeetingsBalanceService } from '../../meetings-balance/meetings-balance.service';

const DEFAULT_BASE_MONTHLY_PRICE_KOPECKS = 6_000_000;
const DEFAULT_PER_EXTRA_SEAT_KOPECKS = 100_000;
const DEFAULT_YEARLY_DISCOUNT_RATE = 0.8;

export const YEARLY_MONTHS = 12;
export const PRORATA_DAYS_IN_MONTH = 30;

function ensureNonNegativeInt(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`SeatService: ${name} должен быть неотрицательным целым (получено ${value})`);
  }
  return value;
}

export interface SubscriptionPricing {
  baseMonthlyKopecks: number;
  seatsExtraKopecks: number;
  monthlyKopecks: number;
  periodKopecks: number;
  discountKopecks: number;
  monthsInPeriod: number;
}

interface PricingParams {
  base: number;
  perSeat: number;
  yearly: number;
}

@Injectable()
export class SeatService {
  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MeetingsBalanceService)
    private readonly meetingsBalance: MeetingsBalanceService,
  ) {}

  private async readPricing(): Promise<PricingParams> {
    const [base, perSeat, yearly] = await Promise.all([
      this.cfg.getDynamic<number>(
        'billing.baseMonthlyKopecks',
        undefined,
        DEFAULT_BASE_MONTHLY_PRICE_KOPECKS,
      ),
      this.cfg.getDynamic<number>(
        'billing.perExtraSeatKopecks',
        undefined,
        DEFAULT_PER_EXTRA_SEAT_KOPECKS,
      ),
      this.cfg.getDynamic<number>(
        'billing.yearlyDiscountRate',
        undefined,
        DEFAULT_YEARLY_DISCOUNT_RATE,
      ),
    ]);
    return { base, perSeat, yearly };
  }

  async calculateMonthlyPriceKopecks(seatsExtra: number): Promise<number> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat } = await this.readPricing();
    return base + seatsExtra * perSeat;
  }

  async calculateYearlyPriceKopecks(seatsExtra: number): Promise<number> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat, yearly } = await this.readPricing();
    const monthly = base + seatsExtra * perSeat;
    const gross = monthly * YEARLY_MONTHS;
    return Math.round(gross * yearly);
  }

  async calculatePricing(
    period: 'monthly' | 'yearly',
    seatsExtra: number,
  ): Promise<SubscriptionPricing> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat, yearly } = await this.readPricing();
    const monthly = base + seatsExtra * perSeat;
    const months = period === 'yearly' ? YEARLY_MONTHS : 1;
    const gross = monthly * months;
    const periodKopecks = period === 'yearly' ? Math.round(gross * yearly) : monthly;
    const discount = period === 'yearly' ? gross - periodKopecks : 0;
    return {
      baseMonthlyKopecks: base,
      seatsExtraKopecks: seatsExtra * perSeat,
      monthlyKopecks: monthly,
      periodKopecks,
      discountKopecks: discount,
      monthsInPeriod: months,
    };
  }

  async calculateAddSeatsMonthlyProrata(args: {
    seatsToAdd: number;
    daysLeftInPeriod: number;
  }): Promise<number> {
    ensureNonNegativeInt('seatsToAdd', args.seatsToAdd);
    ensureNonNegativeInt('daysLeftInPeriod', args.daysLeftInPeriod);
    if (args.seatsToAdd === 0 || args.daysLeftInPeriod === 0) return 0;
    const { perSeat } = await this.readPricing();
    const daysCapped = Math.min(args.daysLeftInPeriod, PRORATA_DAYS_IN_MONTH);
    const fullSeatPrice = args.seatsToAdd * perSeat;
    return Math.round((fullSeatPrice * daysCapped) / PRORATA_DAYS_IN_MONTH);
  }

  async calculateAddSeatsYearlyProrata(args: {
    seatsToAdd: number;
    monthsLeftInPeriod: number;
  }): Promise<number> {
    ensureNonNegativeInt('seatsToAdd', args.seatsToAdd);
    ensureNonNegativeInt('monthsLeftInPeriod', args.monthsLeftInPeriod);
    if (args.seatsToAdd === 0 || args.monthsLeftInPeriod === 0) return 0;
    const { perSeat, yearly } = await this.readPricing();
    const monthsCapped = Math.min(args.monthsLeftInPeriod, YEARLY_MONTHS);
    const full = args.seatsToAdd * perSeat * monthsCapped;
    return Math.round(full * yearly);
  }

  async calculateMeetingsGrant(seatsExtra: number): Promise<number> {
    return this.meetingsBalance.calculateMeetingsGrant(seatsExtra);
  }
}
