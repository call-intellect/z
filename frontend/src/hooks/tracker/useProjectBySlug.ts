'use client';

/**
 * useProjectBySlug — найти проект по slug.
 *
 * Backend GET /projects/:id принимает только id (uuid), но URL у нас по
 * slug. Поэтому грузим список (он закэширован SWR'ом) и фильтруем
 * клиентски. При появлении endpoint'а GET /projects/by-slug/:slug — заменить.
 */

import { useMemo } from 'react';
import { useProjects } from './useProjects';
import type { Project } from '@/domain/tracker';

export function useProjectBySlug(
  orgId: string | null | undefined,
  slug: string | null | undefined,
): {
  project: Project | null;
  error: unknown;
  isLoading: boolean;
} {
  const { projects, isLoading, error } = useProjects(orgId, {
    includeArchived: true,
    limit: 100,
  });

  const project = useMemo<Project | null>(() => {
    if (!slug) return null;
    return projects.find((p) => p.slug === slug) ?? null;
  }, [projects, slug]);

  return { project, isLoading, error };
}
