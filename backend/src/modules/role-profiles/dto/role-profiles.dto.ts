import { z } from 'zod';

/**
 * DTO модуля RoleProfiles (Фаза 0a — материализованный кеш «карта должности»).
 * Реальная сборка профиля — RoleProfileAgent в Фазе 0d.
 */

export const ListRoleProfilesQuerySchema = z.object({
  status: z.enum(['forming', 'ready', 'stale', 'error', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListRoleProfilesQuery = z.infer<typeof ListRoleProfilesQuerySchema>;

export interface RoleProfileListItemDto {
  id: string;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  status: 'forming' | 'ready' | 'stale' | 'error';
  buildVersion: number;
  lastBuildAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleProfileDetailDto extends RoleProfileListItemDto {
  /** Содержимое summaryCache — Json произвольной формы. */
  summary: unknown;
  /** Минимальное число IdeaBlock-ов (role_relevant=true) для готовности. */
  minBlocks: number;
  /** Текущее число IdeaBlock-ов с этим Role и role_relevant=true. */
  currentBlocks: number;
}

export interface RoleProfileRebuildResponseDto {
  status: 'queued' | 'noop';
  jobId: string | null;
  /** Подсказка для UI о том, что реальный enqueue будет в Фазе 0d. */
  todo?: string;
}

export interface RoleProfileBuildStatusDto {
  status: 'idle' | 'queued' | 'running' | 'failed';
  /** Когда job попал в очередь / начал выполняться (с Фазы 0d). */
  since?: string;
  /** Когда последний раз карта собиралась успешно. */
  lastBuildAt?: string;
  /** Опциональная подсказка для UI (например, на этапе stub'а). */
  todo?: string;
}
