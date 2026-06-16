import { z } from 'zod';

export const CrossFunctionalSeveritySchema = z.enum(['low', 'medium', 'high']);
export type CrossFunctionalSeverityDto = z.infer<typeof CrossFunctionalSeveritySchema>;

export const ListCrossFunctionalProcessesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCrossFunctionalProcessesQuery = z.infer<
  typeof ListCrossFunctionalProcessesQuerySchema
>;

export interface CrossFunctionalProcessListItemDto {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: string;
  isCrossFunctional: boolean;
  crossFunctionalScore: number | null;
  activeFrictionCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface ListCrossFunctionalProcessesResponse {
  items: CrossFunctionalProcessListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const ListCrossFunctionalFrictionQuerySchema = z.object({
  includeResolved: z.coerce.boolean().optional().default(false),
});
export type ListCrossFunctionalFrictionQuery = z.infer<
  typeof ListCrossFunctionalFrictionQuerySchema
>;

export interface CrossFunctionalFrictionReportDto {
  id: string;
  processTemplateId: string;
  severity: CrossFunctionalSeverityDto;
  description: string;
  sourceBlockIds: string[];
  involvedDepartmentIds: string[];
  recommendedAction: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCrossFunctionalFrictionResponse {
  items: CrossFunctionalFrictionReportDto[];
}

export const ResolveCrossFunctionalFrictionBodySchema = z.object({
  closingNote: z.string().trim().max(500).optional(),
});
export type ResolveCrossFunctionalFrictionBody = z.infer<
  typeof ResolveCrossFunctionalFrictionBodySchema
>;
