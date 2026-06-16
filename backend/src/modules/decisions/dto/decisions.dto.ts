import { z } from 'zod';

export const DecisionStatusSchema = z.enum([
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
  'superseded',
  'active',
  'rolled_back',
]);
export type DecisionStatusDto = z.infer<typeof DecisionStatusSchema>;

export const DeadlineFilterSchema = z.enum(['overdue', 'upcoming', 'all']);
export type DeadlineFilterDto = z.infer<typeof DeadlineFilterSchema>;

export const TrustTierSchema = z.enum(['auto', 'provisional', 'human']);
export type TrustTierDto = z.infer<typeof TrustTierSchema>;

export const ListDecisionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: DecisionStatusSchema.optional(),
  decided_by: z.string().min(1).max(60).optional(),
  deadline_filter: DeadlineFilterSchema.optional(),
  affects_entity_id: z.string().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListDecisionsQuery = z.infer<typeof ListDecisionsQuerySchema>;

export const SupersedeDecisionBodySchema = z.object({
  supersededByDecisionId: z.string().min(1).max(60),
  supersedeReason: z.string().min(1).max(2_000).optional(),
});
export type SupersedeDecisionBody = z.infer<typeof SupersedeDecisionBodySchema>;

export const ChangeStatusBodySchema = z.object({
  newStatus: DecisionStatusSchema,
  reason: z.string().min(1).max(2_000).optional(),
});
export type ChangeStatusBody = z.infer<typeof ChangeStatusBodySchema>;

export const SetOutcomesBodySchema = z.object({
  actualOutcomes: z.string().min(1).max(8_000),
});
export type SetOutcomesBody = z.infer<typeof SetOutcomesBodySchema>;

export const DisputeDecisionBodySchema = z
  .object({
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DisputeDecisionBody = z.infer<typeof DisputeDecisionBodySchema>;

export const CorrectDecisionBodySchema = z
  .object({
    correctedPayload: z
      .object({
        statement: z.string().trim().min(1).max(8000).optional(),
        rationale: z.string().trim().max(8000).optional(),
      })
      .refine((p) => p.statement !== undefined || p.rationale !== undefined, {
        message: 'Нужно изменить хотя бы одно поле',
      }),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CorrectDecisionBody = z.infer<typeof CorrectDecisionBodySchema>;

export const CreateDecisionBodySchema = z.object({
  statement: z.string().min(3).max(4_000),
  rationale: z.string().min(1).max(8_000).optional(),
  alternatives: z
    .array(
      z.object({
        option: z.string().min(1).max(500),
        reasonRejected: z.string().min(1).max(1_000).optional(),
      }),
    )
    .max(12)
    .optional(),
  decidedByPersonIds: z.array(z.string().min(1).max(60)).max(10).optional(),
  decidedAt: z.string().datetime().optional(),
  deadline: z.string().datetime().optional(),
  status: DecisionStatusSchema.optional(),
  affectsEntityIds: z.array(z.string().min(1).max(60)).max(20).optional(),
});
export type CreateDecisionBody = z.infer<typeof CreateDecisionBodySchema>;

export interface DecisionListItemDto {
  id: string;
  statement: string;
  status: DecisionStatusDto;
  decidedByPersonIds: string[];
  decidedAt: string | null;
  deadline: string | null;
  supersedesId: string | null;
  affectsEntityIds: string[];
  confidence: number | null;
  trustTier: TrustTierDto;
  updatedAt: string;
  createdAt: string;
}

export interface DecisionAlternativeDto {
  option: string;
  reasonRejected: string | null;
}

export interface DecisionDetailDto extends DecisionListItemDto {
  rationale: string | null;
  alternatives: DecisionAlternativeDto[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  actualOutcomes: string | null;
  dataClass: string;
}

export interface ListDecisionsResponse {
  items: DecisionListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DecisionVersionItemDto {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface DecisionHistoryResponse {
  items: DecisionVersionItemDto[];
}

export interface DecisionSupersedeChainResponse {
  ancestors: DecisionListItemDto[];
  descendants: DecisionListItemDto[];
}
