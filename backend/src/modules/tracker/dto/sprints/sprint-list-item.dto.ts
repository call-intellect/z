import { z } from 'zod';

export const SPRINT_STATUS_FILTER_VALUES = ['active', 'completed', 'upcoming', 'all'] as const;
export type SprintStatusFilter = (typeof SPRINT_STATUS_FILTER_VALUES)[number];

export const SPRINT_SCOPE_KIND_VALUES = [
  'org',
  'customer',
  'vendor',
  'person',
  'department',
  'project',
] as const;
export type SprintScopeKind = (typeof SPRINT_SCOPE_KIND_VALUES)[number];

export const SPRINT_STATUS_VALUES = ['active', 'completed', 'upcoming'] as const;
export type SprintStatus = (typeof SPRINT_STATUS_VALUES)[number];

export const SPRINT_SORT_BY_VALUES = ['startDate', 'progress', 'hints'] as const;
export type SprintSortBy = (typeof SPRINT_SORT_BY_VALUES)[number];

export const ListSprintsQuerySchema = z
  .object({
    status: z.enum(SPRINT_STATUS_FILTER_VALUES).optional().default('all'),
    scopeKind: z.enum(SPRINT_SCOPE_KIND_VALUES).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    sortBy: z.enum(SPRINT_SORT_BY_VALUES).optional().default('startDate'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();
export type ListSprintsQuery = z.infer<typeof ListSprintsQuerySchema>;

export interface SprintListItemScopeDto {
  kind: SprintScopeKind;
  label: string;
  refId: string | null;
  isDeleted: boolean;
}

export interface SprintListItemDto {
  id: string;
  projectId: string;
  name: string;
  project: {
    id: string;
    name: string;
    identifier: string;
  };
  scope: SprintListItemScopeDto;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  progress: {
    total: number;
    completed: number;
    ratio: number;
  };
  activeHintsCount: number;
  criticalHintsCount: number;
  linkedMeetingsCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ListSprintsResponse {
  items: SprintListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
