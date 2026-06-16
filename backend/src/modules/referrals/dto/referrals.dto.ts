import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const InnSchema = z
  .string()
  .trim()
  .regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 или 12 цифр');

const LegalFormSchema = z.enum(['self_employed', 'individual_entrepreneur', 'legal_entity']);

export const PublicAttributionBodySchema = z.object({
  slug: z.string().trim().min(4).max(32),
  fingerprint: z.string().trim().min(32).max(64).optional(),
  referer: z.string().trim().max(2000).optional(),
});
export type PublicAttributionBody = z.infer<typeof PublicAttributionBodySchema>;
export class PublicAttributionBodyDto extends createZodDto(PublicAttributionBodySchema) {}

export const CreateReferralBodySchema = z.object({
  contractAccepted: z.literal(true),
  inn: InnSchema.optional(),
  legalForm: LegalFormSchema.optional(),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});
export type CreateReferralBody = z.infer<typeof CreateReferralBodySchema>;
export class CreateReferralBodyDto extends createZodDto(CreateReferralBodySchema) {}

export const UpdateReferralBodySchema = z.object({
  inn: InnSchema.optional(),
  legalForm: LegalFormSchema.optional(),
  payoutDetails: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateReferralBody = z.infer<typeof UpdateReferralBodySchema>;
export class UpdateReferralBodyDto extends createZodDto(UpdateReferralBodySchema) {}

export const ReferralViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  hasPayoutDetails: z.boolean(),
  inn: z.string().nullable(),
  innVerifiedAt: z.string().datetime().nullable(),
  legalForm: LegalFormSchema.nullable(),
  contractAcceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ReferralViewBody = z.infer<typeof ReferralViewSchema>;
export class ReferralViewDto extends createZodDto(ReferralViewSchema) {}

export const ReferralStatsExtendedSchema = z.object({
  totalClients: z.number().int().nonnegative(),
  activePaying: z.number().int().nonnegative(),
  totalEarnedKopecks: z.number().int().nonnegative(),
  totalPaidKopecks: z.number().int().nonnegative(),
  totalPendingKopecks: z.number().int().nonnegative(),
  clicks30d: z.number().int().nonnegative(),
  signups30d: z.number().int().nonnegative(),
  firstPayments30d: z.number().int().nonnegative(),
  conversionClickToPaidPercent: z.number().nonnegative(),
  conversionSignupToPaidPercent: z.number().nonnegative(),
});
export type ReferralStatsExtendedBody = z.infer<typeof ReferralStatsExtendedSchema>;
export class ReferralStatsExtendedDto extends createZodDto(ReferralStatsExtendedSchema) {}

export const ReferralClientMaskedSchema = z.object({
  clientCode: z.string(),
  attachedAt: z.string().datetime(),
  firstPaidAt: z.string().datetime().nullable(),
  status: z.enum(['active', 'churned', 'pending']),
  monthlyEarningsKopecks: z.number().int().nonnegative(),
  totalEarnedKopecks: z.number().int().nonnegative(),
});
export type ReferralClientMaskedBody = z.infer<typeof ReferralClientMaskedSchema>;
export class ReferralClientMaskedDto extends createZodDto(ReferralClientMaskedSchema) {}

export const RewardProgressSchema = z.object({
  hasProfile: z.boolean(),
  activePaying: z.number().int().nonnegative(),
  targetClients: z.number().int().nonnegative(),
  monthlyEarnedKopecks: z.number().int().nonnegative(),
});
export type RewardProgressBody = z.infer<typeof RewardProgressSchema>;
export class RewardProgressDto extends createZodDto(RewardProgressSchema) {}

export const MonthlyPointSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month должен быть YYYY-MM'),
  incomeRub: z.number().int().nonnegative(),
  activeClients: z.number().int().nonnegative(),
});
export type MonthlyPointBody = z.infer<typeof MonthlyPointSchema>;
export class MonthlyPointDto extends createZodDto(MonthlyPointSchema) {}

export const FunnelPeriodSchema = z.enum(['30d', '90d', 'all']);
export type FunnelPeriod = z.infer<typeof FunnelPeriodSchema>;

export const FunnelSchema = z.object({
  period: FunnelPeriodSchema,
  clicks: z.number().int().nonnegative(),
  signups: z.number().int().nonnegative(),
  firstPayments: z.number().int().nonnegative(),
  activeNow: z.number().int().nonnegative(),
  conversions: z.object({
    clickToSignupPercent: z.number().nonnegative(),
    signupToPaidPercent: z.number().nonnegative(),
    clickToPaidPercent: z.number().nonnegative(),
  }),
});
export type FunnelBody = z.infer<typeof FunnelSchema>;
export class FunnelDto extends createZodDto(FunnelSchema) {}

export const FunnelQuerySchema = z.object({
  period: FunnelPeriodSchema.default('30d'),
});
export type FunnelQuery = z.infer<typeof FunnelQuerySchema>;
export class FunnelQueryDto extends createZodDto(FunnelQuerySchema) {}

export const PromoEventBodySchema = z.object({
  type: z.enum(['impression', 'click', 'dismissed']),
  role: z.enum(['owner', 'member']),
});
export type PromoEventBody = z.infer<typeof PromoEventBodySchema>;
export class PromoEventBodyDto extends createZodDto(PromoEventBodySchema) {}

export const AdminMarkPayoutPaidBodySchema = z.object({
  payoutDocumentUrl: z.string().url().optional(),
});
export type AdminMarkPayoutPaidBody = z.infer<typeof AdminMarkPayoutPaidBodySchema>;
export class AdminMarkPayoutPaidBodyDto extends createZodDto(AdminMarkPayoutPaidBodySchema) {}

export const AdminVoidPayoutBodySchema = z.object({
  voidReason: z.string().trim().min(3),
});
export type AdminVoidPayoutBody = z.infer<typeof AdminVoidPayoutBodySchema>;
export class AdminVoidPayoutBodyDto extends createZodDto(AdminVoidPayoutBodySchema) {}

export const AdminClosePeriodBodySchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth должен быть YYYY-MM'),
});
export type AdminClosePeriodBody = z.infer<typeof AdminClosePeriodBodySchema>;
export class AdminClosePeriodBodyDto extends createZodDto(AdminClosePeriodBodySchema) {}
