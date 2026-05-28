/**
 * DTO для биллинговых эндпоинтов (кабинет + админ).
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ────────────────────────── Кабинет ──────────────────────────

export const SubscriptionViewSchema = z.object({
  status: z.enum(['DEMO', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED']),
  paymentMode: z.enum(['paid', 'bonus']).nullable(),
  billingPeriod: z.enum(['monthly', 'yearly']).nullable(),
  startedAt: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  seatsBase: z.number().int().nonnegative(),
  seatsExtra: z.number().int().nonnegative(),
  monthlyPriceKopecks: z.number().int().nonnegative(),
  totalPaidKopecks: z.number().int().nonnegative(),
  autoRenew: z.boolean(),
});

export type SubscriptionViewBody = z.infer<typeof SubscriptionViewSchema>;
export class SubscriptionViewDto extends createZodDto(SubscriptionViewSchema) {}

export const InvoiceViewSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  status: z.enum(['draft', 'issued', 'paid', 'bonus', 'void']),
  paymentMethod: z
    .enum(['card_recurring', 'bank_invoice', 'manual_admin', 'bonus'])
    .nullable(),
  totalKopecks: z.number().int(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
  voidedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  pdfUrl: z.string().url().nullable(),
});
export type InvoiceViewBody = z.infer<typeof InvoiceViewSchema>;
export class InvoiceViewDto extends createZodDto(InvoiceViewSchema) {}

export const InvoiceListResponseSchema = z.object({
  items: z.array(InvoiceViewSchema),
  total: z.number().int().nonnegative(),
});
export type InvoiceListResponseBody = z.infer<typeof InvoiceListResponseSchema>;
export class InvoiceListResponseDto extends createZodDto(InvoiceListResponseSchema) {}

export const QuotaQuerySchema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  seatsExtra: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type QuotaQueryBody = z.infer<typeof QuotaQuerySchema>;
export class QuotaQueryDto extends createZodDto(QuotaQuerySchema) {}

export const QuotaResponseSchema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  seatsExtra: z.number().int().nonnegative(),
  monthlyKopecks: z.number().int().nonnegative(),
  periodKopecks: z.number().int().nonnegative(),
  discountKopecks: z.number().int().nonnegative(),
  monthsInPeriod: z.number().int().positive(),
  meetingsGrant: z.number().int().nonnegative(),
});
export type QuotaResponseBody = z.infer<typeof QuotaResponseSchema>;
export class QuotaResponseDto extends createZodDto(QuotaResponseSchema) {}

// ────────────────────────── Админ ──────────────────────────

export const AdminActivateBodySchema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  seatsBase: z.number().int().min(0).max(10_000).optional(),
  seatsExtra: z.number().int().min(0).max(10_000),
  startedAt: z.string().datetime(),
  paymentMode: z.enum(['paid', 'bonus']),
  reason: z.string().trim().min(3, 'reason обязателен (≥3 символа)'),
  externalRef: z.string().trim().optional(),
});
export type AdminActivateBody = z.infer<typeof AdminActivateBodySchema>;
export class AdminActivateBodyDto extends createZodDto(AdminActivateBodySchema) {}

export const AdminAdjustSeatsBodySchema = z.object({
  newSeatsExtra: z.number().int().min(0).max(10_000),
  reason: z.string().trim().min(3),
  daysLeftInMonthlyPeriod: z.number().int().min(0).max(31).optional(),
  monthsLeftInYearlyPeriod: z.number().int().min(0).max(12).optional(),
});
export type AdminAdjustSeatsBody = z.infer<typeof AdminAdjustSeatsBodySchema>;
export class AdminAdjustSeatsBodyDto extends createZodDto(
  AdminAdjustSeatsBodySchema,
) {}

export const AdminForceStatusBodySchema = z.object({
  newStatus: z.enum([
    'DEMO',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'CANCELED',
    'EXPIRED',
  ]),
  reason: z.string().trim().min(3),
});
export type AdminForceStatusBody = z.infer<typeof AdminForceStatusBodySchema>;
export class AdminForceStatusBodyDto extends createZodDto(
  AdminForceStatusBodySchema,
) {}

export const AdminMarkPaidBodySchema = z.object({
  externalRef: z.string().trim().optional(),
  reason: z.string().trim().min(3),
});
export type AdminMarkPaidBody = z.infer<typeof AdminMarkPaidBodySchema>;
export class AdminMarkPaidBodyDto extends createZodDto(AdminMarkPaidBodySchema) {}

export const AdminVoidInvoiceBodySchema = z.object({
  reason: z.string().trim().min(3),
});
export type AdminVoidInvoiceBody = z.infer<typeof AdminVoidInvoiceBodySchema>;
export class AdminVoidInvoiceBodyDto extends createZodDto(
  AdminVoidInvoiceBodySchema,
) {}

export const AdminActivateResultSchema = z.object({
  subscriptionId: z.string(),
  invoiceId: z.string(),
  grantedMeetings: z.number().int().nonnegative(),
});
export type AdminActivateResultBody = z.infer<typeof AdminActivateResultSchema>;
export class AdminActivateResultDto extends createZodDto(
  AdminActivateResultSchema,
) {}

// ────────────────────────── Pay-flow (Tochka) ──────────────────────────

export const StartCardPaymentBodySchema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  seatsExtra: z.number().int().min(0).max(10_000).default(0),
  autoRenew: z.boolean().default(true),
});
export type StartCardPaymentBody = z.infer<typeof StartCardPaymentBodySchema>;
export class StartCardPaymentBodyDto extends createZodDto(
  StartCardPaymentBodySchema,
) {}

export const StartBankInvoicePaymentBodySchema = z.object({
  billingPeriod: z.enum(['monthly', 'yearly']),
  seatsExtra: z.number().int().min(0).max(10_000).default(0),
  dueInDays: z.number().int().min(1).max(30).default(14),
  sendToEmail: z.boolean().default(false),
});
export type StartBankInvoicePaymentBody = z.infer<
  typeof StartBankInvoicePaymentBodySchema
>;
export class StartBankInvoicePaymentBodyDto extends createZodDto(
  StartBankInvoicePaymentBodySchema,
) {}

export const PaymentStartResultSchema = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  totalKopecks: z.number().int().nonnegative(),
  paymentUrl: z.string().nullable(),
  providerInvoiceId: z.string().nullable(),
});
export type PaymentStartResultBody = z.infer<typeof PaymentStartResultSchema>;
export class PaymentStartResultDto extends createZodDto(PaymentStartResultSchema) {}
