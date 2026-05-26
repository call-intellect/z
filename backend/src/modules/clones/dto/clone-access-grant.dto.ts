import { z } from 'zod';

/**
 * ТЗ 2026-05-26 (clone-access-grant-admin-api) — DTO для admin CRUD по
 * `CloneAccessGrant` и user-эндпоинта `/me/clone-access`.
 *
 * Все тексты ошибок — на русском (memory `feedback_admin_ui_russian_only`).
 *
 * Эндпоинты (§2 ТЗ):
 *   GET    /api/v1/admin/clones/access-grants
 *   POST   /api/v1/admin/clones/access-grants
 *   DELETE /api/v1/admin/clones/access-grants/:id
 *   PATCH  /api/v1/admin/clones/access-grants/:id
 *   GET    /api/v1/admin/clones/:cloneType/:cloneRefId/access-grants
 *   GET    /api/v1/me/clone-access
 */

// ─────────────── общие константы ───────────────

export const CloneTypeSchema = z.enum(['person', 'role']);
export type CloneTypeDto = z.infer<typeof CloneTypeSchema>;

// ─────────────── §2.1 GET list query ───────────────

export const AccessGrantListQuerySchema = z
  .object({
    grantedToUserId: z.string().trim().min(1).max(64).optional(),
    grantedById: z.string().trim().min(1).max(64).optional(),
    cloneType: CloneTypeSchema.optional(),
    cloneRefId: z.string().trim().min(1).max(64).optional(),
    /**
     * isActive=true → только активные (revokedAt=NULL AND (expiresAt=NULL OR >now)).
     * isActive=false → revoked ИЛИ expired.
     * undefined → не фильтруем.
     */
    isActive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type AccessGrantListQueryDto = z.infer<typeof AccessGrantListQuerySchema>;

// ─────────────── §2.2 POST create body ───────────────

export const CreateAccessGrantSchema = z
  .object({
    grantedToUserId: z
      .string({ error: 'Не указан получатель гранта' })
      .trim()
      .min(1, 'Не указан получатель гранта')
      .max(64),
    cloneType: CloneTypeSchema,
    cloneRefId: z
      .string({ error: 'Не указан клон' })
      .trim()
      .min(1, 'Не указан клон')
      .max(64),
    /**
     * ISO-строка истечения. null — бессрочно. Из UI на старте всегда null
     * (UI с date-picker появится позже).
     */
    expiresAt: z
      .string()
      .datetime({ message: 'Поле `expiresAt` должно быть ISO-датой' })
      .nullable()
      .optional()
      .default(null),
  })
  .strict();
export type CreateAccessGrantDto = z.infer<typeof CreateAccessGrantSchema>;

// ─────────────── §2.4 PATCH update body ───────────────

export const UpdateAccessGrantSchema = z
  .object({
    /**
     * Новое значение `expiresAt`. null — снять срок (сделать бессрочным).
     * Поле обязательное (нечего больше менять — иначе зачем PATCH).
     */
    expiresAt: z
      .string()
      .datetime({ message: 'Поле `expiresAt` должно быть ISO-датой' })
      .nullable(),
  })
  .strict();
export type UpdateAccessGrantDto = z.infer<typeof UpdateAccessGrantSchema>;

// ─────────────── §2.5 per-clone query ───────────────

export const AccessGrantPerCloneQuerySchema = z
  .object({
    includeInactive: z.coerce.boolean().optional().default(false),
  })
  .strict();
export type AccessGrantPerCloneQueryDto = z.infer<
  typeof AccessGrantPerCloneQuerySchema
>;

// ─────────────── Response DTO ───────────────

export interface AccessGrantUserSummaryDto {
  userId: string;
  userName: string;
  userEmail?: string;
}

export interface AccessGrantDto {
  id: string;
  cloneType: 'person' | 'role';
  cloneRefId: string;
  /** Человекочитаемое имя клона ('Клон Маркетолога v3' или Person.name). */
  cloneLabel: string;
  grantedTo: AccessGrantUserSummaryDto;
  grantedBy: AccessGrantUserSummaryDto;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: AccessGrantUserSummaryDto | null;
  isActive: boolean;
  /** Причина неактивности — 'revoked' | 'expired' | null. */
  inactiveReason: 'revoked' | 'expired' | null;
}

export interface AccessGrantListResponseDto {
  items: AccessGrantDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ─────────────── §2.6 /me/clone-access ───────────────

export interface MyCloneAccessResponseDto {
  /** personId-ы активных person-грантов. */
  personClones: string[];
  /** roleId-ы активных role-грантов. */
  roleClones: string[];
  /** ISO момента ответа (UI кеширует с этим штампом). */
  fetchedAt: string;
}
