import { z } from 'zod';

import type { ProvenancePreviewRef } from '../../knowledge-core/services/provenance.service';

export const RegulationKindSchema = z.enum([
  'regulation',
  'process',
  'policy',
  'standard',
  'instruction',
]);
export type RegulationKindDto = z.infer<typeof RegulationKindSchema>;

export const ExtractionStatusSchema = z.enum(['exists', 'needed', 'discussed']);
export type ExtractionStatusDto = z.infer<typeof ExtractionStatusSchema>;

export const RegulationStatusSchema = z.enum(['active', 'deprecated', 'archived']);
export type RegulationStatusDto = z.infer<typeof RegulationStatusSchema>;

export const PolicySeverityDtoSchema = z.enum(['advisory', 'mandatory', 'blocking']);
export type PolicySeverityDto = z.infer<typeof PolicySeverityDtoSchema>;

export const TrustTierSchema = z.enum(['auto', 'provisional', 'human']);
export type TrustTierDto = z.infer<typeof TrustTierSchema>;

export const ListRegulationsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: RegulationKindSchema.optional(),
  status: RegulationStatusSchema.optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRegulationsQuery = z.infer<typeof ListRegulationsQuerySchema>;

export const GetRegulationParamsSchema = z.object({
  kind: RegulationKindSchema,
});

export const SupersedeRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
  supersededByRegulationId: z.string().min(1).max(60),
});
export type SupersedeRegulationBody = z.infer<typeof SupersedeRegulationBodySchema>;

export const ConfirmRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
});
export type ConfirmRegulationBody = z.infer<typeof ConfirmRegulationBodySchema>;

export const DisputeRegulationBodySchema = z
  .object({
    kind: RegulationKindSchema,
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DisputeRegulationBody = z.infer<typeof DisputeRegulationBodySchema>;

export const CorrectRegulationBodySchema = z
  .object({
    kind: RegulationKindSchema,
    correctedPayload: z
      .object({
        name: z.string().trim().min(1).max(300).optional(),
        contentMd: z.string().trim().min(1).max(20000).optional(),
        statement: z.string().trim().min(1).max(8000).optional(),
        description: z.string().trim().min(1).max(20000).optional(),
      })
      .refine((p) => Object.values(p).some((v) => v !== undefined), {
        message: 'Нужно изменить хотя бы одно поле',
      }),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CorrectRegulationBody = z.infer<typeof CorrectRegulationBodySchema>;

export interface RegulationListItemDto {
  id: string;
  kind: RegulationKindDto;
  name: string;
  statement: string | null;
  category: 'regulation' | 'standard' | null;
  severity: PolicySeverityDto | null;
  scope: string | null;
  status: RegulationStatusDto;
  ownerPersonId: string | null;
  confidence: number | null;
  extractionStatus?: ExtractionStatusDto | null;
  forRole?: string | null;
  trustTier: TrustTierDto;
  previewQuote: string | null;
  previewSourceRef: ProvenancePreviewRef | null;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessStepDto {
  id: string;
  order: number;
  name: string;
  description: string | null;
  slaMinutes: number | null;
}

export interface RegulationDetailDto extends RegulationListItemDto {
  contentMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  steps?: ProcessStepDto[];
  supersedesId?: string | null;
}

export interface ListRegulationsResponse {
  items: RegulationListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RegulationVersionItemDto {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface RegulationHistoryResponse {
  items: RegulationVersionItemDto[];
}

export interface RegulationSourceMeetingDto {
  id: string;
  title: string;
  date: string;
}

export interface RegulationSourceItemDto {
  blockId: string;
  quote: string;
  startMs: number | null;
  meeting: RegulationSourceMeetingDto | null;
}

export interface RegulationSourcesResponse {
  items: RegulationSourceItemDto[];
}

export interface RegulationSummaryResponse {
  regulations: number;
  processes: number;
  processTemplates: number;
  instructions: number;
  policies: number;
  weekDelta: number;
  /** Ф5 — kill-switch редизайна раздела (`knowledge_base.redesign.enabled`,
   *  дефолт ON). Едет на фронт: true → новая раскладка, false → прежняя. */
  redesignEnabled: boolean;
}
