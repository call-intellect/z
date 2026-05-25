/**
 * Admin-redesign Фаза 4 — DTO для `AdminEntitlementsController`.
 *
 * Глобальный обзор overrides по OrgEntitlement + per-org мутации
 * (upsert tier/featureOverrides/quotaOverrides/notes).
 */

import { z } from 'zod';

export const ListEntitlementsQuerySchema = z.object({
  /**
   * По умолчанию `true` — показываем только Org с override'ами. UI обычно
   * показывает «отклонения от плана». Установка `false` вернёт всех Org
   * с OrgEntitlement-записью (вне зависимости от наличия override).
   */
  hasOverrides: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(true),
  /** Опц. фильтр по конкретному tier (например, tier_pro). */
  plan: z.string().trim().min(1).max(64).optional(),
  /** Cursor-based pagination через `updatedAt + id`. */
  cursor: z.string().trim().min(1).max(512).optional(),
  /** Размер страницы (default 50, max 200). */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEntitlementsQueryDto = z.infer<typeof ListEntitlementsQuerySchema>;

/**
 * Свободный JSON: ключ → значение. По соглашению featureOverrides — это
 * boolean'ы, quotaOverrides — это числа, но валидируем мягко (super_admin
 * может задать null для «явного override плана в значение null»).
 */
const OverridesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string(), z.null()]),
);

export const UpdateEntitlementSchema = z
  .object({
    /** Сменить tier (по сути — смена Plan для этой Org). */
    tier: z.string().trim().min(1).max(64).optional(),
    /** Полная замена featureOverrides. Для удаления конкретного key — DELETE-эндпоинт. */
    featureOverrides: OverridesSchema.nullable().optional(),
    quotaOverrides: OverridesSchema.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateEntitlementDto = z.infer<typeof UpdateEntitlementSchema>;
