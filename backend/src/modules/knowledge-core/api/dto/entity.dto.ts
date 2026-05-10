import { z } from 'zod';

import { ENTITY_TYPE_VALUES } from '../../prompts/block-ingest.prompt';

import type { BlockSearchItemDto, EntityItemDto } from './search.dto';

/**
 * `GET /api/v1/knowledge/entities` — query params.
 *
 *  - `type` — фильтр по типу сущности.
 *  - `q` — ILIKE по canonicalName и aliases.
 *  - `includeMerged` — включать ли уже merged_into Entity (по умолчанию false).
 *  - `limit` / `offset` — пагинация.
 */
export const ListEntitiesQuerySchema = z.object({
  type: z.enum(ENTITY_TYPE_VALUES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  includeMerged: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListEntitiesQuery = z.infer<typeof ListEntitiesQuerySchema>;

export interface ListEntitiesResultDto {
  items: EntityItemDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * `GET /api/v1/knowledge/entities/:id` — деталка сущности с примерами блоков
 * (canonical, top-20 по recency).
 */
export interface EntityDetailDto {
  entity: EntityItemDto;
  blocks: BlockSearchItemDto[];
  /** Если запрошенная сущность merged_into — id целевой canonical-сущности. */
  mergedIntoId?: string;
}
