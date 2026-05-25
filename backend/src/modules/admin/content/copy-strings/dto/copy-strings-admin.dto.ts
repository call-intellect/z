/**
 * Admin-redesign Фаза 5 — DTO для `CopyStringsAdminController`.
 *
 * Глоссарий и UI-строки хранятся как `AdminSetting` с
 * `category='content', section='copy-strings'`. Отдельной модели нет —
 * MVP-стратегия из ТЗ.
 */

import { z } from 'zod';

export const UpdateCopyStringSchema = z.object({
  value: z.string().min(1).max(10_000),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateCopyStringDto = z.infer<typeof UpdateCopyStringSchema>;

export const BulkImportCopyStringsSchema = z.object({
  /** `{ "ui.signin.title": "Войти" }` */
  entries: z.record(z.string().trim().min(2).max(200), z.string().min(1).max(10_000)),
  reason: z.string().trim().max(500).optional(),
});
export type BulkImportCopyStringsDto = z.infer<typeof BulkImportCopyStringsSchema>;
