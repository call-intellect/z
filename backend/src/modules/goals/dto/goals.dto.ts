import { z } from 'zod';

/**
 * DTO для модуля Goals (Фаза 9 knowledge-core).
 *
 * Все поля строго валидируются Zod через `ZodValidationPipe`. Совместимость
 * с frontend `GoalApi` — поля ниже точно совпадают.
 */

// ─────────────────────────── Query / Filters ───────────────────────────

export const ListGoalsQuerySchema = z.object({
  /** 'active' (default), 'paused', 'achieved', 'abandoned', 'all' */
  status: z
    .enum(['active', 'paused', 'achieved', 'abandoned', 'all'])
    .default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListGoalsQuery = z.infer<typeof ListGoalsQuerySchema>;

// ─────────────────────────── Body ──────────────────────────────────────

const NameSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().min(1).max(2000);
const WeightSchema = z.number().min(0.001).max(1.0);
const TargetDateSchema = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();

export const CreateGoalSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  targetDate: TargetDateSchema,
  weight: WeightSchema.optional(),
});
export type CreateGoalDto = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.optional(),
    targetDate: TargetDateSchema,
    weight: WeightSchema.optional(),
    status: z.enum(['active', 'paused', 'achieved', 'abandoned']).optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateGoalDto = z.infer<typeof UpdateGoalSchema>;

export const AddThemesSchema = z.object({
  themeIds: z.array(z.string().min(1)).min(1).max(50),
});
export type AddThemesDto = z.infer<typeof AddThemesSchema>;

// ─────────────────────────── Response DTO ──────────────────────────────

export interface GoalThemeLinkDto {
  themeId: string;
  themeName: string;
  source: 'manual' | 'ai';
  weight: number;
  createdAt: string;
}

export interface GoalAlignmentSnapshotDto {
  id: string;
  goalId: string;
  score: number;
  delta: number | null;
  explanation: string;
  signals: { pro: string[]; contra: string[] };
  windowDays: number;
  themesCount: number;
  blocksCount: number;
  alertPending: boolean;
  createdAt: string;
}

export interface GoalListItemDto {
  id: string;
  name: string;
  description: string;
  targetDate: string | null;
  status: 'active' | 'paused' | 'achieved' | 'abandoned';
  weight: number;
  cachedAlignment: number | null;
  cachedAlignmentAt: string | null;
  cachedAlignmentDelta: number | null;
  themesCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalDetailDto extends GoalListItemDto {
  themes: GoalThemeLinkDto[];
  latestSnapshot: GoalAlignmentSnapshotDto | null;
  /** Последние ≤30 snapshots по убыванию `createdAt`. Для timeline UI. */
  timeline: GoalAlignmentSnapshotDto[];
}

/**
 * Sprint 3 B1-3.2 — issue-based snapshot из Tracker-задач, привязанных к
 * Goal через `Issue.goalId`. Считается cron'ом
 * `goals/cron/strategic-alignment.cron.ts` (06:00 ежедневно) и кэшируется
 * в Redis. Endpoint `GET /goals/:id/alignment-snapshot` отдаёт его быстро,
 * а при cache miss считает on-the-fly.
 *
 * Это ОТДЕЛЬНЫЙ snapshot от LLM-based `GoalAlignmentSnapshotDto` (там —
 * движение по знаниям, здесь — counted-метрики по задачам).
 */
export interface GoalIssueProgressSnapshotDto {
  goalId: string;
  tenantId: string;
  totalLinkedIssues: number;
  completedIssues: number;
  blockedIssues: number;
  recentlyUpdatedIssues: number;
  /** Доля прошедшего времени между createdAt и targetDate в %, null если нет targetDate. */
  timeProgressPct: number | null;
  /** 0..100; формула: 50%*completion + 50%*recency (≤7д). */
  alignmentScore: number;
  /** ISO 8601 UTC, когда снапшот был посчитан. */
  computedAt: string;
  /** true — отдано из Redis-кэша, false — посчитано on-the-fly. */
  fromCache: boolean;
}
