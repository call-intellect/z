/**
 * SeatService — формулы цены подписки + расчёт встреч-гранта.
 *
 * Все суммы в **копейках** (Int) — единый стандарт Z (см. ТЗ §3, поле
 * `Invoice.totalKopecks`, `Subscription.monthlyPriceKopecks`).
 *
 * Бизнес-правила (решения владельца 2026-05-25, ТЗ §4):
 *   Б1 один тариф `tier_standard`
 *   Б2 база = 60 000 ₽/мес, 31 место (1 главный + 30), 150 встреч/мес
 *   Б3 +1 место → +1 000 ₽/мес → +5 встреч/мес
 *   Б4 годовая = base × 12 × 0.80 (скидка 20%)
 *
 * Источник цены — **AdminSetting** (ключи `billing.*`), редактируется через
 * UI super_admin с history + audit. См. ТЗ
 * `plans/tz/2026-05-31-admin-plans-collapse-to-standard.md` §3.1–3.2.
 * Дефолты `DEFAULT_*` — code-fallback на случай недоступности
 * `AdminSettingsService` (минимальный bootstrap, тесты, первый запуск
 * до сидов).
 *
 * Все публичные методы — **async**. Чтение через `TypedConfigService.getDynamic`:
 *   - LRU-кэш 30s в `AdminSettingsService` → повторные вызовы стоят ≈0;
 *   - Redis pub/sub `admin:setting:invalidate` → инвалидация во всех процессах
 *     (HTTP + workers) за <1s.
 *
 * Грант встреч делегируется в `MeetingsBalanceService.calculateMeetingsGrant`
 * (единый источник правды для формулы гранта — там же админ-параметры
 * `billing.baseMeetingsGrant` / `billing.perExtraSeatMeetingsGrant`).
 *
 * Активные `Subscription.monthlyPriceKopecks` ретроактивно НЕ пересчитываются:
 * цена фиксируется на момент покупки/продления (см. ТЗ §1 п.6 / §3.6).
 *
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §4 + §7.1
 * и plans/tz/2026-05-31-admin-plans-collapse-to-standard.md §3.1–3.2.
 */

import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config';
import { MeetingsBalanceService } from '../../meetings-balance/meetings-balance.service';

// ────────────────────────── Code-fallback константы ──────────────────────────

/** Базовая цена `tier_standard` в копейках = 60 000 ₽ × 100 (code-fallback). */
const DEFAULT_BASE_MONTHLY_PRICE_KOPECKS = 6_000_000;
/** Доплата за каждое доп. место в копейках = 1 000 ₽ × 100 (code-fallback). */
const DEFAULT_PER_EXTRA_SEAT_KOPECKS = 100_000;
/** Скидка на годовую подписку. 0.80 = -20% (code-fallback). */
const DEFAULT_YEARLY_DISCOUNT_RATE = 0.8;

/**
 * Число месяцев в годовом периоде — **формат биллинга, не цена**, остаётся
 * в коде (не редактируется через AdminSetting).
 *
 * Экспортируется, потому что используется в `manual-billing.service.ts`
 * (`monthsLeftInYearlyPeriod ?? YEARLY_MONTHS`) и `billing.service.ts`
 * (re-export для cron'ов продления).
 */
export const YEARLY_MONTHS = 12;
/**
 * Принятый «месяц» для pro-rata по дням. 30 дней — стандарт SaaS-биллинга,
 * **не цена**, остаётся в коде. Экспортируется для тестов и потенциальных
 * call-site'ов pro-rata, которым нужен cap по дням.
 */
export const PRORATA_DAYS_IN_MONTH = 30;

/** Pure-проверка: `count >= 0` целое. */
function ensureNonNegativeInt(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`SeatService: ${name} должен быть неотрицательным целым (получено ${value})`);
  }
  return value;
}

// ────────────────────────── Расчёт цены ──────────────────────────

export interface SubscriptionPricing {
  baseMonthlyKopecks: number;
  seatsExtraKopecks: number;
  monthlyKopecks: number;
  /** Сумма за весь оплачиваемый период (`monthlyKopecks × monthsInPeriod` после скидки). */
  periodKopecks: number;
  /** Применённая скидка в копейках (положительное число; для monthly = 0). */
  discountKopecks: number;
  monthsInPeriod: number;
}

interface PricingParams {
  /** Базовая месячная цена в копейках. */
  base: number;
  /** Цена за доп. место в копейках. */
  perSeat: number;
  /** Скидка годовой подписки (доля, 0.8 = -20%). */
  yearly: number;
}

@Injectable()
export class SeatService {
  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MeetingsBalanceService)
    private readonly meetingsBalance: MeetingsBalanceService,
  ) {}

  /**
   * Прочитать 3 ценовых параметра параллельно. После прогрева LRU-кэша
   * (TTL 30s) все три ветки возвращают синхронно из памяти.
   *
   * Параметры гранта встреч НЕ читаются здесь — это ответственность
   * `MeetingsBalanceService.calculateMeetingsGrant`.
   */
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

  /** Месячная цена в копейках для (seatsBase=31 + seatsExtra) мест. */
  async calculateMonthlyPriceKopecks(seatsExtra: number): Promise<number> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat } = await this.readPricing();
    return base + seatsExtra * perSeat;
  }

  /**
   * Цена годовой подписки в копейках:
   *   gross   = monthly × 12
   *   yearly  = round(gross × 0.80)
   */
  async calculateYearlyPriceKopecks(seatsExtra: number): Promise<number> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat, yearly } = await this.readPricing();
    const monthly = base + seatsExtra * perSeat;
    const gross = monthly * YEARLY_MONTHS;
    return Math.round(gross * yearly);
  }

  /**
   * Полный расклад цены для UI/PDF (включая отдельно скидку).
   * Для monthly: discountKopecks=0, periodKopecks=monthlyKopecks.
   * Для yearly:  periodKopecks = gross - discount.
   */
  async calculatePricing(
    period: 'monthly' | 'yearly',
    seatsExtra: number,
  ): Promise<SubscriptionPricing> {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    const { base, perSeat, yearly } = await this.readPricing();
    const monthly = base + seatsExtra * perSeat;
    const months = period === 'yearly' ? YEARLY_MONTHS : 1;
    const gross = monthly * months;
    const periodKopecks =
      period === 'yearly' ? Math.round(gross * yearly) : monthly;
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

  // ────────────────────────── Pro-rata мест ──────────────────────────

  /**
   * Доплата при добавлении `seatsToAdd` мест ВНУТРИ месячной подписки.
   * Формула:
   *   prorata = seatsToAdd × PER_EXTRA_SEAT × daysLeft / PRORATA_DAYS_IN_MONTH
   *
   * `daysLeft` — целые дни до конца текущего месяца (или до currentPeriodEnd
   * если он раньше). Вычисляется вызывающей стороной (нужны календарные данные).
   */
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

  /**
   * Доплата при добавлении мест ВНУТРИ годовой подписки.
   *   prorata = seatsToAdd × PER_EXTRA_SEAT × monthsLeft × YEARLY_DISCOUNT_RATE
   *
   * monthsLeft — целые месяцы до currentPeriodEnd, считается вызывающей стороной.
   */
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

  // ────────────────────────── Грант встреч ──────────────────────────

  /**
   * Стартовый/ежемесячный грант встреч. Делегируется в
   * `MeetingsBalanceService.calculateMeetingsGrant` (единый источник правды
   * для формулы гранта — там же админ-параметры
   * `billing.baseMeetingsGrant` / `billing.perExtraSeatMeetingsGrant`).
   *
   * SeatService остаётся «прокси» для биллинг-кода, чтобы не разносить
   * импорты meetings-balance по billing-сервисам.
   */
  async calculateMeetingsGrant(seatsExtra: number): Promise<number> {
    return this.meetingsBalance.calculateMeetingsGrant(seatsExtra);
  }
}
