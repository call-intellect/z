import { z } from 'zod';

/**
 * DTO для документов проекта (2026-05-27).
 *
 * Контракт: plans/tz/2026-05-27-tracker-project-documents.md §DTO (Zod).
 *
 * Контент `content` — TipTap JSON. На сервере НЕ валидируем структуру строго
 * (`z.unknown()`), поскольку TipTap-схема развивается отдельно. Серверная
 * нормализация плэйнтекста (`contentStripped`) для поиска / AI выполняется
 * в сервисе.
 */

// ── ProjectDocument ────────────────────────────────────────────────────

export const CreateProjectDocumentSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.unknown().optional(),
    contentHtml: z.string().max(2_000_000).optional(),
    contentStripped: z.string().max(2_000_000).optional(),
    parentId: z.string().max(64).nullable().optional(),
  })
  .strict();
export type CreateProjectDocumentDto = z.infer<
  typeof CreateProjectDocumentSchema
>;

export const UpdateProjectDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.unknown().optional(),
    contentHtml: z.string().max(2_000_000).optional(),
    contentStripped: z.string().max(2_000_000).optional(),
    pinned: z.boolean().optional(),
    parentId: z.string().max(64).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateProjectDocumentDto = z.infer<
  typeof UpdateProjectDocumentSchema
>;

// ── Response DTO ───────────────────────────────────────────────────────

/**
 * Полный ответ на `/project-documents/:id` — с контентом.
 */
export interface ProjectDocumentResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  /** TipTap JSON. */
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Краткий вариант для списка `/projects/:projectId/documents`. Без полного
 * `content` — только превью (`contentStripped` первые ~240 симв.), чтобы не
 * передавать килобайты на каждое открытие вкладки.
 */
export interface ProjectDocumentSummaryDto {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Минимальная карточка для блока «Связанные карточки» снизу страницы
 * `/projects/:slug/documents`. Возвращается из
 * `GET /projects/:projectId/linked-cards`.
 */
export interface LinkedCardDto {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: string | null;
  contactName: string | null;
}
