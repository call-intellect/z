import { z } from 'zod';

/**
 * Agents v2 Фаза C1 (2026-05-30) — Admin DTO для PracticeSkill.
 *
 * Public-API клиент НЕ существует — skill'ы только видны/управляются
 * админом через REST `/api/v1/admin/practice-skills/*`. UI отдельно
 * (планируется фронтом во второй волне).
 *
 * Источник: plans/tz/2026-05-29-agents-v2-umbrella.md §C1 «Admin UI».
 */

// ───────────────────────────────────────────────────────────────────────
// Query / Body schemas
// ───────────────────────────────────────────────────────────────────────

export const ListPracticeSkillsQuerySchema = z.object({
  /** Фильтр: 'person' | 'role' | 'org'. */
  scope: z.enum(['person', 'role', 'org']).optional(),
  /** scopeRefId — для точечной фильтрации (например, конкретная роль). */
  scopeRefId: z.string().min(1).max(64).optional(),
  /** Фильтр по статусу. */
  status: z.enum(['shadow', 'active', 'archived', 'deprecated']).optional(),
  /** Поиск по подстроке в trigger (case-insensitive). */
  q: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPracticeSkillsQuery = z.infer<
  typeof ListPracticeSkillsQuerySchema
>;

export const ArchivePracticeSkillBodySchema = z.object({
  /**
   * Обязательное обоснование. ≤2000 символов — пишется в БД как-is для
   * audit-trail в админке.
   */
  archivedReason: z.string().min(5).max(2_000),
});
export type ArchivePracticeSkillBody = z.infer<
  typeof ArchivePracticeSkillBodySchema
>;

export const UpdateTrafficShareBodySchema = z.object({
  /** Новый trafficShare ∈ [0, 1]. 0 = выключить retrieval, 1 = всегда. */
  trafficShare: z.coerce.number().min(0).max(1),
});
export type UpdateTrafficShareBody = z.infer<
  typeof UpdateTrafficShareBodySchema
>;

export const UpdatePinnedBodySchema = z.object({
  /** true → закрепить, false → снять закрепление. */
  pinned: z.boolean(),
});
export type UpdatePinnedBody = z.infer<typeof UpdatePinnedBodySchema>;

// ───────────────────────────────────────────────────────────────────────
// Response DTO
// ───────────────────────────────────────────────────────────────────────

export interface PracticeSkillStepDto {
  order: number;
  action: string;
  emotionalRegister?: string;
  redFlags?: string[];
}

export interface PracticeSkillExampleDto {
  episodeBlockId?: string;
  outcome?: 'success' | 'fail' | 'mixed';
  editDistance?: number;
}

export interface PracticeSkillDto {
  id: string;
  tenantId: string;
  scope: 'person' | 'role' | 'org';
  scopeRefId: string;
  trigger: string;
  steps: PracticeSkillStepDto[];
  examples: PracticeSkillExampleDto[];
  redFlags: string[];
  status: 'shadow' | 'active' | 'archived' | 'deprecated';
  trafficShare: number;
  shadowMetrics: Record<string, unknown> | null;
  successRate: number | null;
  lastUsed: string | null;
  derivedFromConceptIds: string[];
  derivedFromTraitIds: string[];
  derivedFromEpisodeCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  version: number;
}

export interface ListPracticeSkillsResponse {
  items: PracticeSkillDto[];
  total: number;
  page: number;
  limit: number;
}
