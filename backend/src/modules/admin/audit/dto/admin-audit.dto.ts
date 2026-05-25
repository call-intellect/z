/**
 * Admin-redesign Фаза 1 — DTO для `AdminAuditController`.
 *
 * Журнал действий super_admin'а. Источник правды — модель
 * `SuperAdminAccessLog` (Prisma). UI Z-Admin рендерит таблицу с фильтрами
 * по super_admin'у, tenant'у, route/method, временному периоду + сводки
 * по super_admin'ам и routes.
 *
 * Cursor-based pagination через `createdAt + id` (composite). Cursor —
 * base64-кодированный JSON `{ createdAt: ISO, id }`, чтобы UI хранил его
 * как opaque строку.
 */

import { z } from 'zod';

export const ListAuditQuerySchema = z.object({
  /** Опц. фильтр по конкретному super_admin'у (User.id). */
  adminUserId: z.string().trim().min(1).max(64).optional(),
  /** Опц. фильтр по Org (для drill-down «что смотрели в этом тенанте»). */
  tenantId: z.string().trim().min(1).max(64).optional(),
  /** Опц. подстрока в `route` (поиск). */
  route: z.string().trim().min(1).max(255).optional(),
  /** Опц. HTTP-метод. */
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).optional(),
  /** Опц. нижняя граница периода (включительно). */
  from: z.coerce.date().optional(),
  /** Опц. верхняя граница периода (исключительно). */
  to: z.coerce.date().optional(),
  /** Opaque cursor (base64 JSON `{ createdAt, id }`). */
  cursor: z.string().trim().min(1).max(512).optional(),
  /** Размер страницы. По умолчанию 50, максимум 200. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditQueryDto = z.infer<typeof ListAuditQuerySchema>;

export const AuditStatsQuerySchema = z.object({
  /** Период статистики. */
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type AuditStatsQueryDto = z.infer<typeof AuditStatsQuerySchema>;
