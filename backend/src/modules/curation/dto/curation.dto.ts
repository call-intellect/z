import { z } from 'zod';

export const CurationLevelSchema = z.enum(['light', 'deep']);
export type CurationLevelDto = z.infer<typeof CurationLevelSchema>;

export const CurationItemStatusSchema = z.enum(['pending', 'decided', 'expired', 'cancelled']);
export type CurationItemStatusDto = z.infer<typeof CurationItemStatusSchema>;

export const CurationDecisionTypeSchema = z.enum([
  'approve',
  'reject',
  'approve_with_edits',
  'split',
  'merge',
  'supersede',
  'mark_as_misleading',
  'merge_categories',
  'escalate',
]);
export type CurationDecisionTypeDto = z.infer<typeof CurationDecisionTypeSchema>;

export const ConflictStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export type ConflictStatusDto = z.infer<typeof ConflictStatusSchema>;

export const ConflictResolutionSchema = z.enum(['accept_new', 'keep_old', 'merge', 'evolving']);
export type ConflictResolutionDto = z.infer<typeof ConflictResolutionSchema>;

export const ListCurationQueueQuerySchema = z.object({
  level: CurationLevelSchema.optional(),
  status: CurationItemStatusSchema.optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  resourceId: z.string().trim().min(1).max(80).optional(),
  assignedToMe: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(0).max(200).default(50),
});
export type ListCurationQueueQuery = z.infer<typeof ListCurationQueueQuerySchema>;

export const DecideCurationBodySchema = z
  .object({
    decisionType: CurationDecisionTypeSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    reasoning: z.string().trim().max(4_000).optional(),
  })
  .strict();
export type DecideCurationBody = z.infer<typeof DecideCurationBodySchema>;

export const ListConflictsQuerySchema = z.object({
  status: ConflictStatusSchema.optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(0).max(200).default(50),
});
export type ListConflictsQuery = z.infer<typeof ListConflictsQuerySchema>;

export const ResolveConflictBodySchema = z
  .object({
    resolution: ConflictResolutionSchema,
    evolvingMeta: z
      .object({
        existingValidUntil: z.string().datetime(),
        newValidFrom: z.string().datetime(),
      })
      .optional(),
    reasoning: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.resolution === 'evolving' && !data.evolvingMeta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'evolvingMeta обязателен для resolution=evolving (existingValidUntil + newValidFrom)',
        path: ['evolvingMeta'],
      });
    }
  });
export type ResolveConflictBody = z.infer<typeof ResolveConflictBodySchema>;

export const DismissConflictBodySchema = z
  .object({
    reasoning: z.string().trim().max(4_000).optional(),
  })
  .strict();
export type DismissConflictBody = z.infer<typeof DismissConflictBodySchema>;

export const CurationSettingsSchema = z
  .object({
    autoThreshold: z.number().min(0).max(1),
    deepReviewThreshold: z.number().min(0).max(1),
    criticalTypes: z.array(z.string().trim().min(1).max(80)).max(64),
    itemExpiryDays: z.number().int().min(1).max(365),
    autoThresholdByType: z
      .record(z.string().trim().min(1).max(80), z.number().min(0).max(1))
      .optional(),
    deepReviewThresholdByType: z
      .record(z.string().trim().min(1).max(80), z.number().min(0).max(1))
      .optional(),
    provisionalThreshold: z.number().min(0).max(1).optional(),
    provisionalThresholdByType: z
      .record(z.string().trim().min(1).max(80), z.number().min(0).max(1))
      .optional(),
    aiVerifierEnabled: z.boolean().optional(),
    auditSampleRate: z.number().min(0).max(1).optional(),
    autotuneEnabled: z.boolean().optional(),
    thresholdMin: z.number().min(0).max(1).optional(),
    thresholdMax: z.number().min(0).max(1).optional(),
    autotuneStep: z.number().min(0).max(1).optional(),
    minDecisionsForAutotune: z.number().int().min(1).max(100_000).optional(),
    maxProvisionalOverride: z.number().min(0).max(1).optional(),
  })
  .strict();
export type CurationSettingsDto = z.infer<typeof CurationSettingsSchema>;

export const UpdateCurationSettingsBodySchema = CurationSettingsSchema.partial();
export type UpdateCurationSettingsBody = z.infer<typeof UpdateCurationSettingsBodySchema>;

export interface OverrideStatsItemDto {
  resourceType: string;
  totalDecided: number;
  approve: number;
  approveWithEdits: number;
  reject: number;
  other: number;
  overrideRate: number;
}

export interface OverrideStatsResponse {
  items: OverrideStatsItemDto[];
}

export interface ProvisionalAuditStatsItemDto {
  resourceType: string;
  auditDecided: number;
  auditWrong: number;
  provisionalWrongRate: number;
}

export interface ProvisionalAuditStatsResponse {
  items: ProvisionalAuditStatsItemDto[];
}

export const ListCuratorAssignmentsQuerySchema = z.object({
  resourceType: z.string().trim().min(1).max(80).optional(),
});
export type ListCuratorAssignmentsQuery = z.infer<typeof ListCuratorAssignmentsQuerySchema>;

export const CreateCuratorAssignmentBodySchema = z
  .object({
    resourceType: z.string().trim().min(1).max(80),
    curatorUserIds: z.array(z.string().min(1)).min(1).max(50),
    level: CurationLevelSchema.nullable().optional(),
    criteria: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();
export type CreateCuratorAssignmentBody = z.infer<typeof CreateCuratorAssignmentBodySchema>;

export const UpdateCuratorAssignmentBodySchema =
  CreateCuratorAssignmentBodySchema.partial().strict();
export type UpdateCuratorAssignmentBody = z.infer<typeof UpdateCuratorAssignmentBodySchema>;

export interface CurationItemDto {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  level: CurationLevelDto;
  triageReason: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
  status: CurationItemStatusDto;
  assignedToUserId: string | null;
  candidateCuratorIds: string[];
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface CurationItemDetailDto extends CurationItemDto {
  decisions: CurationDecisionDto[];
  relatedConflictIds: string[];
}

export interface CurationDecisionDto {
  id: string;
  curationItemId: string;
  decisionType: CurationDecisionTypeDto;
  payload: Record<string, unknown>;
  reasoning: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface ListCurationQueueResponse {
  items: CurationItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ConflictItemDto {
  id: string;
  tenantId: string;
  resourceType: string;
  existingId: string;
  newId: string;
  evidence: Record<string, unknown>;
  relationType: string;
  detectedBy: string;
  status: ConflictStatusDto;
  resolution: ConflictResolutionDto | null;
  evolvingMeta: Record<string, unknown> | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  reasoning: string | null;
  createdAt: string;
}

export interface ListConflictsResponse {
  items: ConflictItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CuratorAssignmentDto {
  id: string;
  tenantId: string;
  resourceType: string;
  curatorUserIds: string[];
  level: CurationLevelDto | null;
  criteria: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCuratorAssignmentsResponse {
  items: CuratorAssignmentDto[];
}

export const CompletenessParentCardTypeSchema = z.enum([
  'regulation',
  'process',
  'role',
  'company_profile',
]);
export type CompletenessParentCardTypeDto = z.infer<typeof CompletenessParentCardTypeSchema>;

export const CompletenessSlotKindSchema = z.enum(['required', 'optional']);
export type CompletenessSlotKindDto = z.infer<typeof CompletenessSlotKindSchema>;

export const CompletenessSlotStatusSchema = z.enum(['open', 'filled']);
export type CompletenessSlotStatusDto = z.infer<typeof CompletenessSlotStatusSchema>;

export const ListCompletenessSlotsQuerySchema = z.object({
  cardType: CompletenessParentCardTypeSchema.optional(),
  cardId: z.string().trim().min(1).max(80).optional(),
  status: CompletenessSlotStatusSchema.optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListCompletenessSlotsQuery = z.infer<typeof ListCompletenessSlotsQuerySchema>;

export const MarkCompletenessSlotFilledBodySchema = z
  .object({
    filledByUserId: z.string().min(1).optional(),
  })
  .strict();
export type MarkCompletenessSlotFilledBody = z.infer<typeof MarkCompletenessSlotFilledBodySchema>;

export interface CompletenessSlotDto {
  id: string;
  tenantId: string;
  parentCardType: CompletenessParentCardTypeDto;
  parentCardId: string;
  slotName: string;
  slotKind: CompletenessSlotKindDto;
  status: CompletenessSlotStatusDto;
  filledAt: string | null;
  filledByUserId: string | null;
  lastProbedAt: string | null;
  probeAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListCompletenessSlotsResponse {
  items: CompletenessSlotDto[];
  totalCount: number;
}
