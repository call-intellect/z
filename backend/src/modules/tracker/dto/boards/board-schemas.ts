import { z } from 'zod';

/**
 * Tracker Boards (2026-05-27) — Zod-схемы для CRUD доски.
 *
 * ТЗ: plans/tz/2026-05-27-tracker-boards.md.
 *
 * Все схемы `.strict()` — лишние поля → 400. `color` — hex-формат
 * (#RRGGBB). `icon` — emoji или slug иконки lucide (свободная строка
 * до 40 символов). Колонки доски (статусы) общие для всех досок проекта,
 * поэтому здесь не присутствуют.
 */

/** RGB-хексы вида `#RRGGBB`. Регистр не важен — нормализуем на стороне сервиса. */
const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/u, 'Цвет должен быть в формате #RRGGBB');

export const CreateBoardSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: HexColorSchema.optional(),
    icon: z.string().max(40).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type CreateBoardDto = z.infer<typeof CreateBoardSchema>;

export const UpdateBoardSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    color: HexColorSchema.optional(),
    icon: z.string().max(40).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    sequence: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateBoardDto = z.infer<typeof UpdateBoardSchema>;

/**
 * Массовая переустановка `sequence` доски по списку id. Порядок в массиве
 * = новый `sequence` (0..N-1). Идентификаторы должны принадлежать одному
 * проекту — иначе 400.
 */
export const ReorderBoardsSchema = z
  .object({
    boardIds: z.array(z.string().min(1).max(64)).min(1).max(100),
  })
  .strict();
export type ReorderBoardsDto = z.infer<typeof ReorderBoardsSchema>;

/** Query: список досок проекта; `includeArchived=true` чтобы видеть архивные. */
export const ListBoardsQuerySchema = z
  .object({
    includeArchived: z.coerce.boolean().default(false),
  })
  .strict();
export type ListBoardsQuery = z.infer<typeof ListBoardsQuerySchema>;
