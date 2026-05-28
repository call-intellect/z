import { z } from 'zod';

/**
 * DTO для чек-листов внутри задачи (2026-05-27).
 *
 * Контракт: plans/tz/2026-05-27-tracker-checklists.md §DTO (Zod).
 *
 * Чек-лист — плоский список пунктов с галочками. У пункта нет исполнителя/срока,
 * только текст и `isDone`. Несколько чек-листов на одну задачу разрешено.
 */

// ── IssueChecklist ─────────────────────────────────────────────────────

export const CreateChecklistSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CreateChecklistDto = z.infer<typeof CreateChecklistSchema>;

export const UpdateChecklistSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .strict();
export type UpdateChecklistDto = z.infer<typeof UpdateChecklistSchema>;

export const ReorderChecklistsSchema = z
  .object({
    issueId: z.string().min(1).max(64),
    checklistIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  })
  .strict();
export type ReorderChecklistsDto = z.infer<typeof ReorderChecklistsSchema>;

// ── IssueChecklistItem ─────────────────────────────────────────────────

export const CreateChecklistItemSchema = z
  .object({
    text: z.string().min(1).max(500),
  })
  .strict();
export type CreateChecklistItemDto = z.infer<typeof CreateChecklistItemSchema>;

export const UpdateChecklistItemSchema = z
  .object({
    text: z.string().min(1).max(500).optional(),
    isDone: z.boolean().optional(),
    sequence: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateChecklistItemDto = z.infer<typeof UpdateChecklistItemSchema>;

export const ReorderChecklistItemsSchema = z
  .object({
    checklistId: z.string().min(1).max(64),
    itemIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  })
  .strict();
export type ReorderChecklistItemsDto = z.infer<typeof ReorderChecklistItemsSchema>;

/**
 * Массовое создание пунктов чек-листа (UX «paste 10 строк сразу»).
 * Endpoint — `POST /checklist-items/bulk-create`, поэтому checklistId в body.
 */
export const BulkCreateChecklistItemsSchema = z
  .object({
    checklistId: z.string().min(1).max(64),
    lines: z.array(z.string().min(1).max(500)).min(1).max(50),
  })
  .strict();
export type BulkCreateChecklistItemsDto = z.infer<
  typeof BulkCreateChecklistItemsSchema
>;

// ── Response DTO ───────────────────────────────────────────────────────

export interface ChecklistItemResponseDto {
  id: string;
  tenantId: string;
  checklistId: string;
  text: string;
  isDone: boolean;
  sequence: number;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistResponseDto {
  id: string;
  tenantId: string;
  issueId: string;
  title: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  items: ChecklistItemResponseDto[];
  // Per-checklist прогресс (вычисленный) — удобно для прогресс-бара в UI.
  totalCount: number;
  doneCount: number;
}

/** Сводка денормализованных счётчиков задачи (для WS-события progress_changed). */
export interface IssueChecklistProgressDto {
  issueId: string;
  total: number;
  done: number;
}
