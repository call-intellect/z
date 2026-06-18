import { z } from 'zod';

import { ENTITY_TYPE_VALUES } from '../../prompts/block-ingest.prompt';

import type { BlockSearchItemDto, EntityItemDto } from './search.dto';

export const ListEntitiesQuerySchema = z.object({
  type: z.enum(ENTITY_TYPE_VALUES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  includeMerged: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListEntitiesQuery = z.infer<typeof ListEntitiesQuerySchema>;

export interface ListEntitiesResultDto {
  items: EntityItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface EntityDetailDto {
  entity: EntityItemDto;
  blocks: BlockSearchItemDto[];
  mergedIntoId?: string;
}
