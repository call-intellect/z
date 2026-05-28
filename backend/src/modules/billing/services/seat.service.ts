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
 * Источник: plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §4 + §7.1.
 *
 * Все функции — pure (не зависят от DI/БД), чтобы юнит-тесты не требовали моков.
 */

import { Injectable } from '@nestjs/common';

import {
  BASE_MEETINGS_GRANT,
  calculateMeetingsGrant,
  PER_EXTRA_SEAT_MEETINGS_GRANT,
} from '../../meetings-balance/meetings-balance.service';

// ────────────────────────── Тарифные константы ──────────────────────────

/** Базовая цена `tier_standard` в копейках = 60 000 ₽ × 100. */
export const BASE_MONTHLY_PRICE_KOPECKS = 6_000_000;
/** Доплата за каждое доп. место в копейках = 1 000 ₽ × 100. */
export const PER_EXTRA_SEAT_KOPECKS = 100_000;
/** Скидка на годовую подписку. 0.80 = -20%. */
export const YEARLY_DISCOUNT_RATE = 0.8;
/** Число месяцев в годовом периоде. */
export const YEARLY_MONTHS = 12;
/** Принятый «месяц» для pro-rata по дням. 30 дней — стандарт SaaS-биллинга. */
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

@Injectable()
export class SeatService {
  /** Месячная цена в копейках для (seatsBase=30 + seatsExtra) мест. */
  calculateMonthlyPriceKopecks(seatsExtra: number): number {
    ensureNonNegativeInt('seatsExtra', seatsExtra);
    return BASE_MONTHLY_PRICE_KOPECKS + seatsExtra * PER_EXTRA_SEAT_KOPECKS;
  }

  /**
   * Цена годовой подписки в копейках:
   *   gross   = monthly × 12
   *   yearly  = round(gross × 0.80)
   */
  calculateYearlyPriceKopecks(seatsExtra: number): number {
    const monthly = this.calculateMonthlyPriceKopecks(seatsExtra);
    const gross = monthly * YEARLY_MONTHS;
    return Math.round(gross * YEARLY_DISCOUNT_RATE);
  }

  /**
   * Полный расклад цены для UI/PDF (включая отдельно скидку).
   * Для monthly: discountKopecks=0, periodKopecks=monthlyKopecks.
   * Для yearly:  periodKopecks = gross - discount.
   */
  calculatePricing(
    period: 'monthly' | 'yearly',
    seatsExtra: number,
  ): SubscriptionPricing {
    const monthly = this.calculateMonthlyPriceKopecks(seatsExtra);
    const months = period === 'yearly' ? YEARLY_MONTHS : 1;
    const gross = monthly * months;
    const yearly =
      period === 'yearly' ? Math.round(gross * YEARLY_DISCOUNT_RATE) : monthly;
    const discount = period === 'yearly' ? gross - yearly : 0;
    return {
      baseMonthlyKopecks: BASE_MONTHLY_PRICE_KOPECKS,
      seatsExtraKopecks: seatsExtra * PER_EXTRA_SEAT_KOPECKS,
      monthlyKopecks: monthly,
      periodKopecks: yearly,
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
  calculateAddSeatsMonthlyProrata(args: {
    seatsToAdd: number;
    daysLeftInPeriod: number;
  }): number {
    ensureNonNegativeInt('seatsToAdd', args.seatsToAdd);
    ensureNonNegativeInt('daysLeftInPeriod', args.daysLeftInPeriod);
    if (args.seatsToAdd === 0 || args.daysLeftInPeriod === 0) return 0;
    const daysCapped = Math.min(args.daysLeftInPeriod, PRORATA_DAYS_IN_MONTH);
    const fullSeatPrice = args.seatsToAdd * PER_EXTRA_SEAT_KOPECKS;
    return Math.round((fullSeatPrice * daysCapped) / PRORATA_DAYS_IN_MONTH);
  }

  /**
   * Доплата при добавлении мест ВНУТРИ годовой подписки.
   *   prorata = seatsToAdd × PER_EXTRA_SEAT × monthsLeft × YEARLY_DISCOUNT_RATE
   *
   * monthsLeft — целые месяцы до currentPeriodEnd, считается вызывающей стороной.
   */
  calculateAddSeatsYearlyProrata(args: {
    seatsToAdd: number;
    monthsLeftInPeriod: number;
  }): number {
    ensureNonNegativeInt('seatsToAdd', args.seatsToAdd);
    ensureNonNegativeInt('monthsLeftInPeriod', args.monthsLeftInPeriod);
    if (args.seatsToAdd === 0 || args.monthsLeftInPeriod === 0) return 0;
    const monthsCapped = Math.min(args.monthsLeftInPeriod, YEARLY_MONTHS);
    const full = args.seatsToAdd * PER_EXTRA_SEAT_KOPECKS * monthsCapped;
    return Math.round(full * YEARLY_DISCOUNT_RATE);
  }

  // ────────────────────────── Грант встреч ──────────────────────────

  /**
   * Стартовый/ежемесячный грант встреч. Re-export из MeetingsBalanceService,
   * чтобы биллинг-код не лазил в чужой модуль напрямую — это собственная
   * вычислимая величина биллинга (нужна при создании Invoice + грантовании
   * MeetingsBalance.grant).
   */
  calculateMeetingsGrant(seatsExtra: number): number {
    return calculateMeetingsGrant(seatsExtra);
  }

  /** Re-export базы для UI/PDF. */
  readonly baseMeetingsGrant = BASE_MEETINGS_GRANT;
  readonly perExtraSeatMeetingsGrant = PER_EXTRA_SEAT_MEETINGS_GRANT;
}
