import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PlanSnapshotBaseSchema = z.object({
  monthlyPriceRub: z.number().int().nonnegative(),
  monthlyPriceKopecks: z.number().int().nonnegative(),
  seatsIncluded: z.number().int().positive(),
  meetingsIncludedPerMonth: z.number().int().nonnegative(),
});

export const PlanSnapshotExtraSeatSchema = z.object({
  monthlyPriceRubPerSeat: z.number().int().nonnegative(),
  monthlyPriceKopecksPerSeat: z.number().int().nonnegative(),
  meetingsPerSeat: z.number().int().nonnegative(),
});

export const PlanSnapshotYearlySchema = z.object({
  discountPercent: z.number().min(0).max(100),
  monthlyEquivalentRub: z.number().int().nonnegative(),
  fullYearRub: z.number().int().nonnegative(),
});

export const PlanSnapshotEditableSettingSchema = z.object({
  key: z.string().min(1),
  currentValue: z.number(),
  severity: z.enum(['low', 'medium', 'high', 'destructive']),
});

const FeaturesSchema = z.record(z.string(), z.boolean());
const QuotasSchema = z.record(z.string(), z.number());

export const PlanSnapshotSchema = z.object({
  tier: z.literal('tier_standard'),
  displayName: z.string().min(1),
  description: z.string(),
  base: PlanSnapshotBaseSchema,
  extraSeat: PlanSnapshotExtraSeatSchema,
  yearly: PlanSnapshotYearlySchema,
  features: FeaturesSchema,
  quotas: QuotasSchema,
  orgsUsingCount: z.number().int().nonnegative(),
  legacyOrgsRemainingCount: z.number().int().nonnegative(),
  editableSettings: z.array(PlanSnapshotEditableSettingSchema),
});

export class PlanSnapshotDto extends createZodDto(PlanSnapshotSchema) {}

export type PlanSnapshot = z.infer<typeof PlanSnapshotSchema>;
