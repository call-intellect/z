'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { projectsApi } from '@/api/tracker/projects.api';
import {
  projectFromApi,
  projectMemberFromApi,
  type Project,
  type ProjectMember,
} from '@/domain/tracker';

/**
 * Один проект по ID (или slug — backend принимает только id, slug-резолв
 * пока на стороне фронта через `useProjects`).
 */
export function useProject(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  project: Project | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId ? ['tracker.project', orgId, projectId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return projectsApi.get(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const project = useMemo<Project | null>(
    () => (swr.data ? projectFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    project,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

/** Список участников проекта. */
export function useProjectMembers(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  members: ProjectMember[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId
      ? ['tracker.project.members', orgId, projectId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error('orgId/projectId required');
      return projectsApi.listMembers(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const members = useMemo<ProjectMember[]>(
    () => (swr.data ? swr.data.map(projectMemberFromApi) : []),
    [swr.data],
  );

  return {
    members,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
