/**
 * Билинг-константы. Часть значений совпадает с Prisma-enum (SubscriptionStatus,
 * PaymentMode, InvoiceStatus, BillingPaymentMethod, BillingProviderName),
 * часть — внутренние строковые литералы (OperationType, BillingEventType).
 *
 * Источник:
 *   - port-brief §4 (исходный проект).
 *   - ТЗ plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §6 + §10.
 */

// ════════════════════════════════════════════════════════════════════════════
// Re-export prisma enum'ов для удобства импорта из одного места.
// ════════════════════════════════════════════════════════════════════════════

export {
  BillingPaymentMethod,
  BillingPeriod,
  BillingProviderName,
  InvoiceStatus,
  PaymentMode,
  SubscriptionStatus,
} from '@prisma/client';

// ════════════════════════════════════════════════════════════════════════════
// Внутренние строковые константы.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Тип бизнес-операции для `SubscriptionEvent.eventType`. Хранится строкой
 * (не enum-Prisma), чтобы добавлять новые без миграции схемы.
 */
export const SubscriptionEventType = {
  CREATED: 'created',
  ACTIVATED_PAID: 'activated_paid',
  ACTIVATED_BONUS: 'activated_bonus',
  RENEWED: 'renewed',
  PAST_DUE: 'past_due',
  SUSPENDED: 'suspended',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  SEATS_CHANGED: 'seats_changed',
  STATUS_FORCED: 'status_forced',
  PROVIDER_RECURRING_CANCELED: 'provider_recurring_canceled',
} as const;
export type SubscriptionEventType =
  (typeof SubscriptionEventType)[keyof typeof SubscriptionEventType];

/**
 * Тип строки в `Invoice.items` (Json). Каждая строка имеет `kind` —
 * категория начисления (база, доп. места, pro-rata, скидка годовой и т.п.).
 */
export const InvoiceItemKind = {
  BASE: 'base',
  SEATS: 'seats',
  SEATS_PRORATA: 'seats_prorata',
  YEARLY_DISCOUNT: 'yearly_discount',
} as const;
export type InvoiceItemKind =
  (typeof InvoiceItemKind)[keyof typeof InvoiceItemKind];

export interface InvoiceItem {
  kind: InvoiceItemKind;
  /** Количество единиц (мест / месяцев). */
  qty: number;
  /** Цена за единицу в копейках. */
  unitKopecks: number;
  /** Итого по строке в копейках. Для скидок — отрицательное число. */
  totalKopecks: number;
  /** Человекочитаемое описание для PDF. */
  note: string;
}

/**
 * Тип события для `BillingEventLog.eventType` (не путать с
 * SubscriptionEventType — там история подписки, здесь — события провайдера
 * + бизнес-операции).
 */
export const BillingEventType = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_ACTIVATED_PAID: 'subscription.activated_paid',
  SUBSCRIPTION_ACTIVATED_BONUS: 'subscription.activated_bonus',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
  INVOICE_CREATED: 'invoice.created',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_VOIDED: 'invoice.voided',
  PROVIDER_WEBHOOK: 'provider.webhook',
  MANUAL_ACTIVATE_PAID: 'manual.activate_paid',
  MANUAL_ACTIVATE_BONUS: 'manual.activate_bonus',
  MANUAL_ADJUST_SEATS: 'manual.adjust_seats',
  MANUAL_FORCE_STATUS: 'manual.force_status',
} as const;
export type BillingEventType =
  (typeof BillingEventType)[keyof typeof BillingEventType];

// ════════════════════════════════════════════════════════════════════════════
// DI-токены.
// ════════════════════════════════════════════════════════════════════════════

/** DI-токен для `BillingProviderPort` — фабрика выбирает реализацию по ENV. */
export const BILLING_PROVIDER = 'BILLING_PROVIDER' as const;
