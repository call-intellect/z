/**
 * DTO для эндпоинтов реферальной программы.
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.2 + §11.3 + §11.4.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const InnSchema = z
  .string()
  .trim()
  .regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 или 12 цифр');

const LegalFormSchema = z.enum([
  'self_employed',
  'individual_entrepreneur',
  'legal_entity',
]);

// ────────────────────────── Public (beacon) ──────────────────────────

export const PublicAttributionBodySchema = z.object({
  slug: z.string().trim().min(4).max(32),
  fingerprint: z.string().trim().max(64).optional(),
  referer: z.string().trim().max(2000).optional(),
});
export type PublicAttributionBody = z.infer<typeof PublicAttributionBodySchema>;
export class PublicAttributionBodyDto extends createZodDto(
  PublicAttributionBodySchema,
) {}

// ────────────────────────── Cabinet ──────────────────────────

export const CreateReferralBodySchema = z.object({
  inn: InnSchema,
  legalForm: LegalFormSchema,
  payoutDetails: z.record(z.string(), z.unknown()),
});
export type CreateReferralBody = z.infer<typeof CreateReferralBodySchema>;
export class CreateReferralBodyDto extends createZodDto(
  CreateReferralBodySchema,
) {}

export const UpdateReferralBodySchema = z.object({
  inn: InnSchema.optional(),
  legalForm: LegalFormSchema.optional(),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateReferralBody = z.infer<typeof UpdateReferralBodySchema>;
export class UpdateReferralBodyDto extends createZodDto(
  UpdateReferralBodySchema,
) {}

export const ReferralViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  inn: z.string(),
  innVerifiedAt: z.string().datetime().nullable(),
  legalForm: LegalFormSchema,
  contractAcceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ReferralViewBody = z.infer<typeof ReferralViewSchema>;
export class ReferralViewDto extends createZodDto(ReferralViewSchema) {}

export const ReferralStatsSchema = z.object({
  totalClients: z.number().int().nonnegative(),
  activePaying: z.number().int().nonnegative(),
  totalEarnedKopecks: z.number().int().nonnegative(),
  totalPaidKopecks: z.number().int().nonnegative(),
  totalPendingKopecks: z.number().int().nonnegative(),
});
export type ReferralStatsBody = z.infer<typeof ReferralStatsSchema>;
export class ReferralStatsDto extends createZodDto(ReferralStatsSchema) {}

// ────────────────────────── Admin ──────────────────────────

export const AdminMarkPayoutPaidBodySchema = z.object({
  payoutDocumentUrl: z.string().url().optional(),
});
export type AdminMarkPayoutPaidBody = z.infer<
  typeof AdminMarkPayoutPaidBodySchema
>;
export class AdminMarkPayoutPaidBodyDto extends createZodDto(
  AdminMarkPayoutPaidBodySchema,
) {}

export const AdminVoidPayoutBodySchema = z.object({
  voidReason: z.string().trim().min(3),
});
export type AdminVoidPayoutBody = z.infer<typeof AdminVoidPayoutBodySchema>;
export class AdminVoidPayoutBodyDto extends createZodDto(
  AdminVoidPayoutBodySchema,
) {}

export const AdminClosePeriodBodySchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth должен быть YYYY-MM'),
});
export type AdminClosePeriodBody = z.infer<typeof AdminClosePeriodBodySchema>;
export class AdminClosePeriodBodyDto extends createZodDto(
  AdminClosePeriodBodySchema,
) {}
