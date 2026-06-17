import { z } from 'zod';

export const ListPracticeSkillsQuerySchema = z.object({
  scope: z.enum(['person', 'role', 'org']).optional(),
  scopeRefId: z.string().min(1).max(64).optional(),
  status: z.enum(['shadow', 'active', 'archived', 'deprecated']).optional(),
  q: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPracticeSkillsQuery = z.infer<typeof ListPracticeSkillsQuerySchema>;

export const ArchivePracticeSkillBodySchema = z.object({
  archivedReason: z.string().min(5).max(2_000),
});
export type ArchivePracticeSkillBody = z.infer<typeof ArchivePracticeSkillBodySchema>;

export const UpdateTrafficShareBodySchema = z.object({
  trafficShare: z.coerce.number().min(0).max(1),
});
export type UpdateTrafficShareBody = z.infer<typeof UpdateTrafficShareBodySchema>;

export const UpdatePinnedBodySchema = z.object({
  pinned: z.boolean(),
});
export type UpdatePinnedBody = z.infer<typeof UpdatePinnedBodySchema>;

export interface PracticeSkillStepDto {
  order: number;
  action: string;
  emotionalRegister?: string;
  redFlags?: string[];
}

export interface PracticeSkillExampleDto {
  episodeBlockId?: string;
  outcome?: 'success' | 'fail' | 'mixed';
  editDistance?: number;
}

export interface PracticeSkillDto {
  id: string;
  tenantId: string;
  scope: 'person' | 'role' | 'org';
  scopeRefId: string;
  trigger: string;
  steps: PracticeSkillStepDto[];
  examples: PracticeSkillExampleDto[];
  redFlags: string[];
  status: 'shadow' | 'active' | 'archived' | 'deprecated';
  trafficShare: number;
  shadowMetrics: Record<string, unknown> | null;
  successRate: number | null;
  lastUsed: string | null;
  derivedFromConceptIds: string[];
  derivedFromTraitIds: string[];
  derivedFromEpisodeCount: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  version: number;
}

export interface ListPracticeSkillsResponse {
  items: PracticeSkillDto[];
  total: number;
  page: number;
  limit: number;
}
