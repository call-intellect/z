import { z } from 'zod';

export const RuleTypeEnum = z.enum(['must_do', 'must_not_do', 'tone', 'structure']);
export type RuleTypeDto = z.infer<typeof RuleTypeEnum>;

export const RuleSourceEnum = z.enum(['autorule', 'manual_admin']);
export type RuleSourceDto = z.infer<typeof RuleSourceEnum>;

export const RuleStatusEnum = z.enum(['shadow', 'active', 'archived', 'overridden_by_admin']);
export type RuleStatusDto = z.infer<typeof RuleStatusEnum>;

export const ListPromptRulesQuerySchema = z
  .object({
    promptKey: z.string().min(1).max(120).optional(),
    status: RuleStatusEnum.optional(),
    source: RuleSourceEnum.optional(),
    tenantId: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListPromptRulesQuery = z.infer<typeof ListPromptRulesQuerySchema>;

export interface PromptRuleDto {
  id: string;
  tenantId: string | null;
  promptKey: string;
  rule: string;
  ruleType: RuleTypeDto;
  source: RuleSourceDto;
  status: RuleStatusDto;
  confidence: number;
  examples: Array<{
    originalSnippet: string;
    editedSnippet: string;
    why: string;
  }>;
  shadowMetrics: { runs: number; withRuleScore: number; withoutRuleScore: number } | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
}

export interface ListPromptRulesResponse {
  items: PromptRuleDto[];
  total: number;
  page: number;
  limit: number;
}

export const ArchiveRuleBodySchema = z
  .object({
    archivedReason: z.string().min(1).max(500),
  })
  .strict();
export type ArchiveRuleBody = z.infer<typeof ArchiveRuleBodySchema>;

export const OverrideRuleBodySchema = z.object({}).strict();
export type OverrideRuleBody = z.infer<typeof OverrideRuleBodySchema>;

export const CopyToManualBodySchema = z.object({}).strict();
export type CopyToManualBody = z.infer<typeof CopyToManualBodySchema>;

export const CandidateStatusEnum = z.enum(['pareto_pool', 'testing', 'promoted', 'rejected']);
export type CandidateStatusDto = z.infer<typeof CandidateStatusEnum>;

export const ListPromptCandidatesQuerySchema = z
  .object({
    promptKey: z.string().min(1).max(120).optional(),
    status: CandidateStatusEnum.optional(),
    tenantId: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListPromptCandidatesQuery = z.infer<typeof ListPromptCandidatesQuerySchema>;

export interface PromptCandidateDto {
  id: string;
  tenantId: string | null;
  promptKey: string;
  parentVersion: string | null;
  promptText: string;
  paretoMetric: Record<string, number>;
  status: CandidateStatusDto;
  evaluations: number;
  compositeScore: number | null;
  abTrafficShare: number | null;
  abStartedAt: string | null;
  abEndedAt: string | null;
  promotedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export interface ListPromptCandidatesResponse {
  items: PromptCandidateDto[];
  total: number;
  page: number;
  limit: number;
}

export const RejectCandidateBodySchema = z
  .object({
    reason: z.string().min(1).max(200).default('manual_reject'),
  })
  .strict();
export type RejectCandidateBody = z.infer<typeof RejectCandidateBodySchema>;

export const RollbackPromptBodySchema = z
  .object({
    tenantId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();
export type RollbackPromptBody = z.infer<typeof RollbackPromptBodySchema>;

export const LockEvolutionBodySchema = z
  .object({
    enabled: z.boolean(),
    tenantId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();
export type LockEvolutionBody = z.infer<typeof LockEvolutionBodySchema>;
