import { z } from 'zod';

import type { ProvenancePreviewRef } from '../../knowledge-core/services/provenance.service';

export const TaskSolutionStatusSchema = z.enum(['active', 'deprecated', 'archived']);
export type TaskSolutionStatusDto = z.infer<typeof TaskSolutionStatusSchema>;

export const ListTaskSolutionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  ownerPersonId: z.string().trim().min(1).max(60).optional(),
  skill: z.string().trim().min(1).max(120).optional(),
  status: TaskSolutionStatusSchema.optional(),
  candidateInstruction: z.coerce.boolean().optional(),
  deleted: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTaskSolutionsQuery = z.infer<typeof ListTaskSolutionsQuerySchema>;

export interface TaskSolutionListItemDto {
  id: string;
  title: string;
  taskDescription: string;
  ownerPersonId: string;
  ownerName: string | null;
  skillTags: string[];
  status: TaskSolutionStatusDto;
  sourceIssueId: string;
  repeatGroupKey: string | null;
  repeatGroupSize: number;
  candidateInstruction: boolean;
  promotedToInstructionId: string | null;
  previewQuote: string | null;
  previewSourceRef: ProvenancePreviewRef | null;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface TaskSolutionDetailDto extends TaskSolutionListItemDto {
  solutionMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  version: number;
  dataClass: string;
  sourceIssueIdentifier: string | null;
  sourceIssueTitle: string | null;
}

export interface ListTaskSolutionsResponse {
  items: TaskSolutionListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TaskSolutionVersionItemDto {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}
export interface TaskSolutionHistoryResponse {
  items: TaskSolutionVersionItemDto[];
}

export interface TaskSolutionSourceMeetingDto {
  id: string;
  title: string;
  date: string;
}
export interface TaskSolutionSourceItemDto {
  blockId: string;
  quote: string;
  startMs: number | null;
  meeting: TaskSolutionSourceMeetingDto | null;
}
export interface TaskSolutionSourcesResponse {
  items: TaskSolutionSourceItemDto[];
}

export interface TaskSolutionSummaryResponse {
  total: number;
  candidates: number;
  weekDelta: number;
}
