import { z } from 'zod';

export const ListGoalsQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'achieved', 'abandoned', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListGoalsQuery = z.infer<typeof ListGoalsQuerySchema>;

const NameSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().min(1).max(2000);
const WeightSchema = z.number().min(0.001).max(1.0);
const TargetDateSchema = z.string().datetime({ offset: true }).nullable().optional();

const HorizonSchema = z.enum(['strategic', 'annual', 'quarterly', 'monthly', 'sprint']);
const ProgressStatusSchema = z.enum(['on_track', 'at_risk', 'stalled', 'achieved', 'dropped']);
const PromotionStateSchema = z.enum(['suggested', 'active', 'dismissed']);

export const CreateGoalSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema,
  targetDate: TargetDateSchema,
  weight: WeightSchema.optional(),
  parentGoalId: z.string().min(1).nullable().optional(),
  horizon: HorizonSchema.optional(),
  ownerPersonId: z.string().min(1).nullable().optional(),
});
export type CreateGoalDto = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z
  .object({
    name: NameSchema.optional(),
    description: DescriptionSchema.optional(),
    targetDate: TargetDateSchema,
    weight: WeightSchema.optional(),
    status: z.enum(['active', 'paused', 'achieved', 'abandoned']).optional(),
    parentGoalId: z.string().min(1).nullable().optional(),
    horizon: HorizonSchema.optional(),
    progressStatus: ProgressStatusSchema.optional(),
    promotionState: PromotionStateSchema.optional(),
    ownerPersonId: z.string().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateGoalDto = z.infer<typeof UpdateGoalSchema>;

export const AddThemesSchema = z.object({
  themeIds: z.array(z.string().min(1)).min(1).max(50),
});
export type AddThemesDto = z.infer<typeof AddThemesSchema>;

export const SetGoalPrioritySchema = z
  .object({
    priority: z.enum(['must', 'should', 'could', 'wont']).nullable(),
  })
  .strict();
export type SetGoalPriorityDto = z.infer<typeof SetGoalPrioritySchema>;

export const SupersedeGoalSchema = z.object({
  name: NameSchema.optional(),
  description: DescriptionSchema.optional(),
  targetDate: TargetDateSchema,
  horizon: HorizonSchema.optional(),
  weight: WeightSchema.optional(),
});
export type SupersedeGoalDto = z.infer<typeof SupersedeGoalSchema>;

const KrNameSchema = z.string().trim().min(1).max(200);
const KrUnitSchema = z.string().trim().min(1).max(50).nullable();
const KrSourceKindSchema = z.enum(['manual', 'meeting_count', 'issue_rollup', 'metric_entity']);
const KrSourceConfigSchema = z.record(z.string(), z.unknown());

export const CreateKeyResultSchema = z.object({
  name: KrNameSchema,
  unit: KrUnitSchema.optional(),
  startValue: z.number().finite(),
  targetValue: z.number().finite(),
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
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateKeyResultDto = z.infer<typeof UpdateKeyResultSchema>;

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

export interface GoalKeyResultDto {
  id: string;
  goalId: string;
  name: string;
  unit: string | null;
  startValue: number;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  sourceKind: 'manual' | 'meeting_count' | 'issue_rollup' | 'metric_entity';
  source: 'manual' | 'ai';
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
  source: 'manual' | 'ai';
  promotionState: 'suggested' | 'active' | 'dismissed';
  progressStatus: 'on_track' | 'at_risk' | 'stalled' | 'achieved' | 'dropped';
  parentGoalId: string | null;
  isPrimary: boolean;
  horizon: 'strategic' | 'annual' | 'quarterly' | 'monthly' | 'sprint';
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  blocksCount: number | null;
}

export interface GoalDetailDto extends GoalListItemDto {
  themes: GoalThemeLinkDto[];
  latestSnapshot: GoalAlignmentSnapshotDto | null;
  timeline: GoalAlignmentSnapshotDto[];
  confidence: number | null;
  keyResults: GoalKeyResultDto[];
}

export interface GoalParentCandidateDto {
  goalId: string;
  name: string;
}

export interface SuggestParentResponse {
  suggestedParentGoalId: string | null;
  verdict: 'duplicate' | 'child_of' | 'standalone';
  candidates: GoalParentCandidateDto[];
  reasoning: string | null;
  confidence: number | null;
}

export interface GoalIssueProgressSnapshotDto {
  goalId: string;
  tenantId: string;
  totalLinkedIssues: number;
  completedIssues: number;
  blockedIssues: number;
  recentlyUpdatedIssues: number;
  timeProgressPct: number | null;
  alignmentScore: number;
  computedAt: string;
  fromCache: boolean;
}
