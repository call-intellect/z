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

/** Goals OKR v2 — горизонт цели (совпадает с enum GoalHorizon в schema). */
const HorizonSchema = z.enum([
  'strategic',
  'annual',
  'quarterly',
  'monthly',
  'sprint',
]);
/** Goals OKR v2 — ось движения для пульса (совпадает с enum GoalProgressStatus). */
const ProgressStatusSchema = z.enum([
  'on_track',
  'at_risk',
  'stalled',
  'achieved',
  'dropped',
]);
/** Goals OKR v2 — жизненный цикл предложения (совпадает с enum GoalPromotionState). */
const PromotionStateSchema = z.enum(['suggested', 'active', 'dismissed']);

export const CreateGoalSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  targetDate: TargetDateSchema,
  weight: WeightSchema.optional(),
  /** Goals OKR v2 — родитель в дереве целей. null/опущено = корневая. */
  parentGoalId: z.string().min(1).nullable().optional(),
  horizon: HorizonSchema.optional(),
});
export type CreateGoalDto = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.optional(),
    targetDate: TargetDateSchema,
    weight: WeightSchema.optional(),
    status: z.enum(['active', 'paused', 'achieved', 'abandoned']).optional(),
    /** Goals OKR v2 — перепривязка в дереве (null = открепить). */
    parentGoalId: z.string().min(1).nullable().optional(),
    horizon: HorizonSchema.optional(),
    progressStatus: ProgressStatusSchema.optional(),
    promotionState: PromotionStateSchema.optional(),
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

// ─────────────────────── Goals OKR v2 — supersede ──────────────────────

/**
 * Goals OKR v2 — «передумали через 2 дня»: создать новую версию цели
 * (наследует поля старой, поля ниже переопределяют). Все опц. — пустой
 * supersede = чистая копия старой версии. `.refine` НЕ нужен: даже без
 * полей это валидное действие (создать преемника-копию).
 */
export const SupersedeGoalSchema = z.object({
  name: NameSchema.optional(),
  description: DescriptionSchema.optional(),
  targetDate: TargetDateSchema,
  horizon: HorizonSchema.optional(),
  weight: WeightSchema.optional(),
});
export type SupersedeGoalDto = z.infer<typeof SupersedeGoalSchema>;

// ─────────────────── Goals OKR v2 — Key Results (KR) ────────────────────

const KrNameSchema = z.string().trim().min(1).max(200);
const KrUnitSchema = z.string().trim().min(1).max(50).nullable();
const KrSourceKindSchema = z.enum([
  'manual',
  'meeting_count',
  'issue_rollup',
  'metric_entity',
]);
const KrSourceConfigSchema = z.record(z.string(), z.unknown());

export const CreateKeyResultSchema = z.object({
  name: KrNameSchema,
  unit: KrUnitSchema.optional(),
  startValue: z.number().finite(),
  targetValue: z.number().finite(),
  /** Опц.; если не задан — currentValue = startValue. */
  currentValue: z.number().finite().optional(),
  sourceKind: KrSourceKindSchema.default('manual'),
  sourceConfig: KrSourceConfigSchema.default({}),
});
export type CreateKeyResultDto = z.infer<typeof CreateKeyResultSchema>;

export const UpdateKeyResultSchema = z
  .object({
    name: KrNameSchema.optional(),
    unit: KrUnitSchema.optional(),
    startValue: z.number().finite().optional(),
    targetValue: z.number().finite().optional(),
    currentValue: z.number().finite().optional(),
    sourceKind: KrSourceKindSchema.optional(),
    sourceConfig: KrSourceConfigSchema.optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateKeyResultDto = z.infer<typeof UpdateKeyResultSchema>;

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

/** Goals OKR v2 — измеримый ориентир (Key Result). */
export interface GoalKeyResultDto {
  id: string;
  goalId: string;
  name: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  /** clamp 0..100 от (current-start)/(target-start)*100; 0 при target==start. */
  progressPercent: number;
  sourceKind: 'manual' | 'meeting_count' | 'issue_rollup' | 'metric_entity';
  source: 'manual' | 'ai';
  /** Имена «прибитых» руками полей (AI их не перетирает, M0). */
  manualOverride: string[];
  createdAt: string;
  updatedAt: string;
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
  // ── Goals OKR v2 ──
  source: 'manual' | 'ai';
  promotionState: 'suggested' | 'active' | 'dismissed';
  progressStatus: 'on_track' | 'at_risk' | 'stalled' | 'achieved' | 'dropped';
  parentGoalId: string | null;
}

export interface GoalDetailDto extends GoalListItemDto {
  themes: GoalThemeLinkDto[];
  latestSnapshot: GoalAlignmentSnapshotDto | null;
  /** Последние ≤30 snapshots по убыванию `createdAt`. Для timeline UI. */
  timeline: GoalAlignmentSnapshotDto[];
  // ── Goals OKR v2 ──
  confidence: number | null;
  /** Измеримые ориентиры цели по возрастанию `createdAt`. */
  keyResults: GoalKeyResultDto[];
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
