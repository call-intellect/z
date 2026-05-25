/**
 * Admin-redesign Фаза 4 — DTO для `AdminPlansController`.
 *
 * Plans (тарифы продукта) — CRUD планов, которые используются OrgEntitlement
 * (через строковое поле `tier`). Полей мало, но `features`/`quotas` — это
 * Json со свободной структурой, поэтому валидируем как объект с string→value.
 */

import { z } from 'zod';

/**
 * Идентификатор плана. Совпадает с `OrgEntitlement.tier` (свободная строка,
 * не enum). Префикс `tier_` — конвенция, см. seed (`tier_basic`/`tier_pro`/
 * `tier_enterprise`).
 */
const PlanIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9_]+$/i, 'id может содержать только латиницу, цифры и подчёркивания');

const FeaturesSchema = z.record(z.string(), z.union([z.boolean(), z.string(), z.number()]));
const QuotasSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

export const CreatePlanSchema = z.object({
  id: PlanIdSchema,
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  features: FeaturesSchema,
  quotas: QuotasSchema,
  monthlyPriceRub: z.number().int().min(0).max(100_000_000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

export const UpdatePlanSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    features: FeaturesSchema.optional(),
    quotas: QuotasSchema.optional(),
    monthlyPriceRub: z.number().int().min(0).max(100_000_000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdatePlanDto = z.infer<typeof UpdatePlanSchema>;
