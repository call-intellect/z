import { z } from 'zod';

export const ListSubjectMemoryQuerySchema = z
  .object({
    status: z
      .enum(['shadow', 'canary', 'active', 'superseded', 'rolled_back', 'disabled'])
      .optional(),
    kind: z.enum(['term', 'disambiguation', 'preference']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListSubjectMemoryQuery = z.infer<typeof ListSubjectMemoryQuerySchema>;

export interface SubjectMemoryItemDto {
  id: string;
  kind: string;
  contextText: string;
  ruleText: string;
  status: string;
  confidence: number;
  confirmCount: number;
  refuteCount: number;
  sourceProbeIds: string[];
  appliedCount: number;
  occurredAt: string;
  lastAppliedAt: string | null;
  createdAt: string;
}

export interface ListSubjectMemoryResponse {
  items: SubjectMemoryItemDto[];
  total: number;
  page: number;
  limit: number;
  countsByStatus: Record<string, number>;
}
