import { z } from 'zod';

/**
 * DTO для Org-Admin knowledge-core debug (Фаза 7 шаг 7).
 */

export const SetWorkersSchema = z
  .record(z.string(), z.boolean())
  .refine((m) => Object.keys(m).length > 0, {
    message: 'хотя бы один воркер должен быть указан',
  });
export type SetWorkersDto = z.infer<typeof SetWorkersSchema>;

export const RecentAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  /** CSV-список типов сущностей: `block,entity,theme`. Парсится в контроллере. */
  entityTypes: z.string().optional(),
});
export type RecentAuditQuery = z.infer<typeof RecentAuditQuerySchema>;

export function parseEntityTypesCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return arr.length > 0 ? arr : undefined;
}

export const ListLinksQuerySchema = z.object({
  kind: z.enum(['block', 'entity']),
  sortBy: z.enum(['confidence', 'createdAt']).default('createdAt'),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListLinksQuery = z.infer<typeof ListLinksQuerySchema>;

export const DeleteLinkQuerySchema = z.object({
  kind: z.enum(['block', 'entity']),
});
export type DeleteLinkQuery = z.infer<typeof DeleteLinkQuerySchema>;

export const BulkDeleteLinksSchema = z.object({
  kind: z.enum(['block', 'entity']),
  status: z.enum(['active', 'archived']).optional(),
  maxConfidence: z.number().min(0).max(1).optional(),
  beforeDate: z.coerce.date().optional(),
});
export type BulkDeleteLinksDto = z.infer<typeof BulkDeleteLinksSchema>;

export const MergeEntitiesSchema = z.object({
  intoEntityId: z.string().min(1).max(100),
});
export type MergeEntitiesDto = z.infer<typeof MergeEntitiesSchema>;

export const PatchEntitySchema = z
  .object({
    canonicalName: z.string().min(1).max(200).optional(),
    addAlias: z.string().min(1).max(200).optional(),
  })
  .refine(
    (v) => v.canonicalName !== undefined || v.addAlias !== undefined,
    { message: 'нужно передать хотя бы canonicalName или addAlias' },
  );
export type PatchEntityDto = z.infer<typeof PatchEntitySchema>;
