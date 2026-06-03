import { z } from 'zod';

/**
 * DTO модуля Decisions (SBA β-3). REST API `/api/v1/decisions` — реестр
 * решений компании.
 *
 * Под капотом — Prisma-таблица `decisions` (расширенная in-place из Фазы 0a).
 * Все user-facing строки — на русском.
 */

export const DecisionStatusSchema = z.enum([
  // β-3 значения
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
  'superseded',
  // legacy Фазы 0a — для обратной совместимости (могут существовать в БД).
  'active',
  'rolled_back',
]);
export type DecisionStatusDto = z.infer<typeof DecisionStatusSchema>;

export const DeadlineFilterSchema = z.enum(['overdue', 'upcoming', 'all']);
export type DeadlineFilterDto = z.infer<typeof DeadlineFilterSchema>;

export const TrustTierSchema = z.enum(['auto', 'provisional', 'human']);
export type TrustTierDto = z.infer<typeof TrustTierSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

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
export type SupersedeDecisionBody = z.infer<
  typeof SupersedeDecisionBodySchema
>;

export const ChangeStatusBodySchema = z.object({
  newStatus: DecisionStatusSchema,
  reason: z.string().min(1).max(2_000).optional(),
});
export type ChangeStatusBody = z.infer<typeof ChangeStatusBodySchema>;

export const SetOutcomesBodySchema = z.object({
  actualOutcomes: z.string().min(1).max(8_000),
});
export type SetOutcomesBody = z.infer<typeof SetOutcomesBodySchema>;

// Manual create — owner/admin only (UI на β-3 не добавляем; см. §14.3 sub-TZ).
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

// ─────────────────────────── Response DTOs ───────────────────────────

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
  /** Цепочка вверх (родительские, от прямого предка к самому древнему). */
  ancestors: DecisionListItemDto[];
  /** Цепочка вниз (потомки — Decision'ы, чей supersedesId = this.id). */
  descendants: DecisionListItemDto[];
}
