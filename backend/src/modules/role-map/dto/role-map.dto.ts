import { z } from 'zod';

export const RESPONSIBILITY_KINDS = ['outcome', 'function', 'activity'] as const;
export type ResponsibilityKind = (typeof RESPONSIBILITY_KINDS)[number];

export const AUTHORITY_KINDS = ['allowed', 'requires_approval', 'forbidden'] as const;
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number];

export const KNOWLEDGE_IMPORTANCE = ['mandatory', 'preferred', 'nice_to_have'] as const;
export type KnowledgeImportance = (typeof KNOWLEDGE_IMPORTANCE)[number];

export const KNOWLEDGE_LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

export const INTERACTION_KINDS = [
  'reports_to',
  'collaborates_with',
  'delegates_to',
  'receives_handoff_from',
  'escalates_to',
  'customer_facing',
  'supplier_facing',
  'mentor_to',
  'mentored_by',
  'other',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const INTERACTION_FREQUENCIES = ['daily', 'weekly', 'monthly', 'ad_hoc'] as const;
export type InteractionFrequency = (typeof INTERACTION_FREQUENCIES)[number];

export const CreateResponsibilityElementSchema = z.object({
  parentId: z.string().min(1).nullable().optional(),
  kind: z.enum(RESPONSIBILITY_KINDS),
  name: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  order: z.coerce.number().int().min(0).max(10_000).optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
});
export type CreateResponsibilityElementDto = z.infer<typeof CreateResponsibilityElementSchema>;

export const UpdateResponsibilityElementSchema = CreateResponsibilityElementSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Хотя бы одно поле должно быть указано' },
);
export type UpdateResponsibilityElementDto = z.infer<typeof UpdateResponsibilityElementSchema>;

export interface ResponsibilityElementDto {
  id: string;
  tenantId: string;
  roleId: string;
  parentId: string | null;
  kind: ResponsibilityKind;
  name: string;
  description: string | null;
  order: number;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CreateAuthorityBoundarySchema = z.object({
  kind: z.enum(AUTHORITY_KINDS),
  scope: z.string().min(1).max(4000),
  approverRoleId: z.string().min(1).nullable().optional(),
  thresholdsJson: z.record(z.string(), z.unknown()).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
});
export type CreateAuthorityBoundaryDto = z.infer<typeof CreateAuthorityBoundarySchema>;

export const UpdateAuthorityBoundarySchema = CreateAuthorityBoundarySchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Хотя бы одно поле должно быть указано' },
);
export type UpdateAuthorityBoundaryDto = z.infer<typeof UpdateAuthorityBoundarySchema>;

export interface AuthorityBoundaryDto {
  id: string;
  tenantId: string;
  roleId: string;
  kind: AuthorityKind;
  scope: string;
  approverRoleId: string | null;
  approverRoleName: string | null;
  thresholdsJson: Record<string, unknown> | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CreateRequiredKnowledgeSchema = z.object({
  topic: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  importance: z.enum(KNOWLEDGE_IMPORTANCE),
  expectedLevel: z.enum(KNOWLEDGE_LEVELS).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
});
export type CreateRequiredKnowledgeDto = z.infer<typeof CreateRequiredKnowledgeSchema>;

export const UpdateRequiredKnowledgeSchema = CreateRequiredKnowledgeSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Хотя бы одно поле должно быть указано' },
);
export type UpdateRequiredKnowledgeDto = z.infer<typeof UpdateRequiredKnowledgeSchema>;

export interface RequiredKnowledgeDto {
  id: string;
  tenantId: string;
  roleId: string;
  topic: string;
  description: string | null;
  importance: KnowledgeImportance;
  expectedLevel: KnowledgeLevel | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CreateDecisionPolicySchema = z.object({
  name: z.string().min(1).max(300),
  conditionDescription: z.string().max(4000).nullable().optional(),
  ruleDescription: z.string().min(1).max(4000),
  regulationId: z.string().min(1).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
});
export type CreateDecisionPolicyDto = z.infer<typeof CreateDecisionPolicySchema>;

export const UpdateDecisionPolicySchema = CreateDecisionPolicySchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  { message: 'Хотя бы одно поле должно быть указано' },
);
export type UpdateDecisionPolicyDto = z.infer<typeof UpdateDecisionPolicySchema>;

export interface DecisionPolicyDto {
  id: string;
  tenantId: string;
  roleId: string;
  name: string;
  conditionDescription: string | null;
  ruleDescription: string;
  regulationId: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CreateInteractionSchema = z
  .object({
    kind: z.enum(INTERACTION_KINDS),
    counterpartRoleId: z.string().min(1).nullable().optional(),
    counterpartDepartmentId: z.string().min(1).nullable().optional(),
    counterpartExternal: z.string().min(1).max(300).nullable().optional(),
    frequency: z.enum(INTERACTION_FREQUENCIES).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    confidence: z.coerce.number().min(0).max(1).optional(),
    sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.counterpartRoleId) ||
      Boolean(v.counterpartDepartmentId) ||
      Boolean(v.counterpartExternal),
    {
      message: 'Должен быть указан хотя бы один counterpart: roleId, departmentId или external',
    },
  );
export type CreateInteractionDto = z.infer<typeof CreateInteractionSchema>;

export const UpdateInteractionSchema = z
  .object({
    kind: z.enum(INTERACTION_KINDS).optional(),
    counterpartRoleId: z.string().min(1).nullable().optional(),
    counterpartDepartmentId: z.string().min(1).nullable().optional(),
    counterpartExternal: z.string().min(1).max(300).nullable().optional(),
    frequency: z.enum(INTERACTION_FREQUENCIES).nullable().optional(),
    description: z.string().max(4000).nullable().optional(),
    confidence: z.coerce.number().min(0).max(1).optional(),
    sourceBlockIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateInteractionDto = z.infer<typeof UpdateInteractionSchema>;

export interface InteractionDto {
  id: string;
  tenantId: string;
  roleId: string;
  kind: InteractionKind | string;
  counterpartRoleId: string | null;
  counterpartRoleName: string | null;
  counterpartDepartmentId: string | null;
  counterpartDepartmentName: string | null;
  counterpartExternal: string | null;
  frequency: InteractionFrequency | string | null;
  description: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleMapDto {
  role: {
    id: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    missionStatement: string | null;
  };
  responsibilities: ResponsibilityElementDto[];
  authority: AuthorityBoundaryDto[];
  knowledge: RequiredKnowledgeDto[];
  decisions: DecisionPolicyDto[];
  interactions: InteractionDto[];
  metrics: Array<{
    id: string;
    name: string;
    unit: string | null;
    targetValue: number | null;
    currentValue: number | null;
  }>;
  completeness: number;
  maturityScore: number | null;
  counts: {
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  };
  summaryCache: unknown;
  builtAt: string | null;
  isForming: boolean;
}

export interface RoleMaturityDto {
  roleId: string;
  roleName: string;
  maturityScore: number | null;
  completeness: number;
  rationale: string | null;
  contributingFactors: Array<{
    label: string;
    value: number;
    weight: number;
  }>;
  perCategory: {
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  };
}
