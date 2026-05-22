import { z } from 'zod';

/**
 * DTO модуля Regulations (SBA α-7). REST API `/api/v1/regulations` —
 * единый список Regulation / Process / Policy с фильтром `kind`.
 *
 * Под капотом — 3 отдельные Prisma-таблицы (`Regulation`, `Process`, `Policy`),
 * расширенные in-place из Фазы 0b. UI/клиент работает с ними как с единым
 * списком (см. план α-7, решение по §14.1).
 *
 * Все user-facing строки — на русском.
 */

export const RegulationKindSchema = z.enum([
  'regulation',
  'process',
  'policy',
  'standard',
]);
export type RegulationKindDto = z.infer<typeof RegulationKindSchema>;

/**
 * Status — общий для Regulation/Process/Policy (Prisma enum `ProcessStatus`).
 * `active` соответствует «canonical» в терминах Слоя 4 (триаж одобрил).
 */
export const RegulationStatusSchema = z.enum([
  'active',
  'deprecated',
  'archived',
]);
export type RegulationStatusDto = z.infer<typeof RegulationStatusSchema>;

export const PolicySeverityDtoSchema = z.enum([
  'advisory',
  'mandatory',
  'blocking',
]);
export type PolicySeverityDto = z.infer<typeof PolicySeverityDtoSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

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
export type GetRegulationParamsQuery = z.infer<typeof GetRegulationParamsSchema>;

export const SupersedeRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
  supersededByRegulationId: z.string().min(1).max(60),
});
export type SupersedeRegulationBody = z.infer<typeof SupersedeRegulationBodySchema>;

export const ConfirmRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
});
export type ConfirmRegulationBody = z.infer<typeof ConfirmRegulationBodySchema>;

// ─────────────────────────── Response DTOs ───────────────────────────

export interface RegulationListItemDto {
  id: string;
  kind: RegulationKindDto;
  name: string;
  statement: string | null;
  /** Только для kind='regulation': 'regulation' | 'standard'. */
  category: 'regulation' | 'standard' | null;
  /** Только для kind='policy'. */
  severity: PolicySeverityDto | null;
  scope: string | null;
  status: RegulationStatusDto;
  ownerPersonId: string | null;
  confidence: number | null;
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
  /** Только для kind='process'. */
  steps?: ProcessStepDto[];
  /** Только для kind='regulation': self-relation на предыдущую версию. */
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
