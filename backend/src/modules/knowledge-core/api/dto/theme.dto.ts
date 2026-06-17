import { z } from 'zod';

import { THEME_BRANCH_VALUES } from '../../services/theme-classification.service';

import type { BlockSearchItemDto, EntityItemDto } from './search.dto';

export const ListThemesQuerySchema = z.object({
  branch: z.enum(THEME_BRANCH_VALUES).optional(),
  status: z.enum(['active', 'archived', 'merged_into']).default('active'),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListThemesQuery = z.infer<typeof ListThemesQuerySchema>;

export interface ThemeItemDto {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  status: string;
  weight: number;
  confidence: number;
  dynamic: string;
  lastSignalAt: string | null;
  blocksCount: number;
  entitiesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListThemesResultDto {
  items: ThemeItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface ThemeDetailDto {
  theme: ThemeItemDto;
  blocks: BlockSearchItemDto[];
  entities: EntityItemDto[];
  mergedIntoId?: string;
}

export const SaveThemeAsCardSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export type SaveThemeAsCardDto = z.infer<typeof SaveThemeAsCardSchema>;

export interface ThemeSavedAsCardDto {
  cardId: string;
  name: string;
  kind: string;
  bornFromThemeId: string;
}
