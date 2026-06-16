import { z } from 'zod';

export const ListRoleProfilesQuerySchema = z.object({
  status: z.enum(['forming', 'ready', 'stale', 'error', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListRoleProfilesQuery = z.infer<typeof ListRoleProfilesQuerySchema>;

export interface RoleProfileListItemDto {
  id: string;
  roleId: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  status: 'forming' | 'ready' | 'stale' | 'error';
  buildVersion: number;
  lastBuildAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleProfileDetailDto extends RoleProfileListItemDto {
  summary: unknown;
  minBlocks: number;
  currentBlocks: number;
}

export interface RoleProfileRebuildResponseDto {
  status: 'queued' | 'noop';
  jobId: string | null;
  todo?: string;
}

export interface RoleProfileBuildStatusDto {
  status: 'idle' | 'queued' | 'running' | 'failed';
  since?: string;
  lastBuildAt?: string;
  todo?: string;
}
