import { z } from 'zod';

import { THEME_BRANCH_VALUES } from '../../services/theme-classification.service';

import type { BlockSearchItemDto, EntityItemDto } from './search.dto';

/**
 * `GET /api/v1/knowledge/themes` — query params.
 *
 *  - `branch` — фильтр по ветке (12 enum + 'none' опускаем для clients).
 *  - `status` — по умолчанию 'active'.
 *  - `q` — ILIKE по name (для будущих расширений; на старте опционально).
 *  - `limit` / `offset` — пагинация.
 */
export const ListThemesQuerySchema = z.object({
  branch: z.enum(THEME_BRANCH_VALUES).optional(),
  status: z.enum(['active', 'archived', 'merged_into']).default('active'),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListThemesQuery = z.infer<typeof ListThemesQuerySchema>;

/** Минимальный shape темы для списка / детали. */
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

/** `GET /api/v1/knowledge/themes/:id` — деталка темы. */
export interface ThemeDetailDto {
  theme: ThemeItemDto;
  blocks: BlockSearchItemDto[];
  entities: EntityItemDto[];
  /** Если запрошенная тема merged_into — id целевой темы. */
  mergedIntoId?: string;
}

/**
 * `POST /api/v1/knowledge/themes/:id/save-as-card` — body.
 *
 * `name` опционален: если не передан — возьмём `Theme.name`. На уникальность
 * `Card(ownerId, name)` валидирует CardsService через ConflictException.
 */
export const SaveThemeAsCardSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export type SaveThemeAsCardDto = z.infer<typeof SaveThemeAsCardSchema>;

/** Минимальный shape карточки в ответе save-as-card. */
export interface ThemeSavedAsCardDto {
  cardId: string;
  name: string;
  kind: string;
  bornFromThemeId: string;
}
