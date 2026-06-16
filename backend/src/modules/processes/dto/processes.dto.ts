import { z } from 'zod';

export const ProcessTemplateStatusSchema = z.enum(['active', 'deprecated', 'archived']);
export type ProcessTemplateStatusDto = z.infer<typeof ProcessTemplateStatusSchema>;

export const ProcessTemplateVersionSourceSchema = z.enum(['manual', 'agent', 'imported']);
export type ProcessTemplateVersionSourceDto = z.infer<typeof ProcessTemplateVersionSourceSchema>;

export const ProcessHandoffKindSchema = z.enum([
  'document',
  'data',
  'decision',
  'physical',
  'notification',
]);
export type ProcessHandoffKindDto = z.infer<typeof ProcessHandoffKindSchema>;

export const ProcessStepDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  order: z.number().int().min(1),
  ownerRoleId: z.string().min(1).max(60).optional(),
  inputArtifact: z.string().trim().max(300).optional(),
  outputArtifact: z.string().trim().max(300).optional(),
  slaMinutes: z.number().int().positive().optional(),
});
export type ProcessStepDefinitionDto = z.infer<typeof ProcessStepDefinitionSchema>;

export const ProcessTemplateDefinitionSchema = z.object({
  steps: z.array(ProcessStepDefinitionSchema).max(50).default([]),
  handoffsInline: z
    .array(
      z.object({
        fromStepOrder: z.number().int().min(1).optional(),
        toStepOrder: z.number().int().min(1).optional(),
        kind: ProcessHandoffKindSchema,
        payloadDescription: z.string().trim().max(500).optional(),
      }),
    )
    .max(50)
    .default([]),
  decisionPointsInline: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        condition: z.string().trim().max(500).optional(),
        afterStepOrder: z.number().int().min(1).optional(),
      }),
    )
    .max(50)
    .default([]),
});
export type ProcessTemplateDefinitionDto = z.infer<typeof ProcessTemplateDefinitionSchema>;

export const ListProcessTemplatesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: ProcessTemplateStatusSchema.optional(),
  ownerEntityId: z.string().min(1).max(60).optional(),
  completenessMin: z.coerce.number().min(0).max(1).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProcessTemplatesQuery = z.infer<typeof ListProcessTemplatesQuerySchema>;

export const CreateProcessTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2_000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  ownerRoleId: z.string().min(1).max(60).optional(),
  ownerPersonId: z.string().min(1).max(60).optional(),
});
export type CreateProcessTemplateBody = z.infer<typeof CreateProcessTemplateBodySchema>;

export const UpdateProcessTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(2_000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  ownerRoleId: z.string().min(1).max(60).nullable().optional(),
  ownerPersonId: z.string().min(1).max(60).nullable().optional(),
  status: ProcessTemplateStatusSchema.optional(),
});
export type UpdateProcessTemplateBody = z.infer<typeof UpdateProcessTemplateBodySchema>;

export const CreateProcessTemplateVersionBodySchema = z.object({
  definition: ProcessTemplateDefinitionSchema,
  source: ProcessTemplateVersionSourceSchema.default('manual'),
  changeNote: z.string().trim().max(2_000).optional(),
  activateImmediately: z.boolean().optional(),
});
export type CreateProcessTemplateVersionBody = z.infer<
  typeof CreateProcessTemplateVersionBodySchema
>;

export const ListDecisionPointsQuerySchema = z.object({
  templateId: z.string().min(1).max(60).optional(),
  templateVersionId: z.string().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListDecisionPointsQuery = z.infer<typeof ListDecisionPointsQuerySchema>;

export const CreateDecisionPointBodySchema = z.object({
  templateId: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(300),
  condition: z.string().trim().max(2_000).optional(),
  branches: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
        leadsToStepOrder: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(10),
  decidedByRoleId: z.string().min(1).max(60).optional(),
  order: z.number().int().min(0).default(0),
});
export type CreateDecisionPointBody = z.infer<typeof CreateDecisionPointBodySchema>;

export const UpdateDecisionPointBodySchema = CreateDecisionPointBodySchema.partial().omit({
  templateId: true,
});
export type UpdateDecisionPointBody = z.infer<typeof UpdateDecisionPointBodySchema>;

export const ListProcessHandoffsQuerySchema = z.object({
  sourceTemplateId: z.string().min(1).max(60).optional(),
  targetTemplateId: z.string().min(1).max(60).optional(),
  kind: ProcessHandoffKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListProcessHandoffsQuery = z.infer<typeof ListProcessHandoffsQuerySchema>;

export const CreateProcessHandoffBodySchema = z.object({
  fromTemplateId: z.string().min(1).max(60).optional(),
  toTemplateId: z.string().min(1).max(60).optional(),
  fromRoleId: z.string().min(1).max(60).optional(),
  toRoleId: z.string().min(1).max(60).optional(),
  kind: ProcessHandoffKindSchema,
  payloadDescription: z.string().trim().max(2_000).optional(),
  expectedSlaHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 365)
    .optional(),
});
export type CreateProcessHandoffBody = z.infer<typeof CreateProcessHandoffBodySchema>;

export const UpdateProcessHandoffBodySchema = CreateProcessHandoffBodySchema.partial();
export type UpdateProcessHandoffBody = z.infer<typeof UpdateProcessHandoffBodySchema>;

export const ExtractProcessTemplateBodySchema = z.object({
  blockIds: z.array(z.string().min(1).max(60)).min(1).max(100),
});
export type ExtractProcessTemplateBody = z.infer<typeof ExtractProcessTemplateBodySchema>;

export interface ProcessTemplateListItemDto {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: ProcessTemplateStatusDto;
  currentVersionId: string | null;
  ownerRoleId: string | null;
  ownerPersonId: string | null;
  completeness: number;
  stepsCount: number;
  decisionPointsCount: number;
  handoffsCount: number;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessTemplateVersionDto {
  id: string;
  version: number;
  definition: ProcessTemplateDefinitionDto;
  source: ProcessTemplateVersionSourceDto;
  changeNote: string | null;
  publishedById: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface DecisionPointDto {
  id: string;
  templateId: string | null;
  name: string;
  condition: string | null;
  branches: Array<{
    name: string;
    description?: string;
    leadsToStepOrder?: number;
  }>;
  decidedByRoleId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessHandoffDto {
  id: string;
  fromTemplateId: string | null;
  toTemplateId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  kind: ProcessHandoffKindDto;
  payloadDescription: string | null;
  expectedSlaHours: number | null;
  knownFrictionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessTemplateDetailDto extends ProcessTemplateListItemDto {
  sourceBlockIds: string[];
  currentVersion: ProcessTemplateVersionDto | null;
  decisionPoints: DecisionPointDto[];
  handoffsFrom: ProcessHandoffDto[];
  handoffsTo: ProcessHandoffDto[];
}

export interface ListProcessTemplatesResponse {
  items: ProcessTemplateListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListProcessTemplateVersionsResponse {
  items: ProcessTemplateVersionDto[];
}

export interface ListDecisionPointsResponse {
  items: DecisionPointDto[];
  total: number;
}

export interface ListProcessHandoffsResponse {
  items: ProcessHandoffDto[];
  total: number;
}

export interface ExtractProcessTemplateResponse {
  ok: true;
  enqueuedJobId: string;
  blockIdsCount: number;
}
