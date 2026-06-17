"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { projectsApi } from "@/api/tracker/projects.api";
import { projectFromApi, type Project } from "@/domain/tracker";

export function useProjectBySlug(
  orgId: string | null | undefined,
  slug: string | null | undefined,
): {
  project: Project | null;
  error: unknown;
  isLoading: boolean;
} {
  const key = orgId && slug ? ["tracker.project.by-slug", orgId, slug] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !slug) throw new Error("orgId/slug required");
      return projectsApi.getBySlug(orgId, slug);
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: (err: unknown) => {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "project_not_found"
        ) {
          return false;
        }
        return true;
      },
    },
  );

  const project = useMemo<Project | null>(
    () => (swr.data ? projectFromApi(swr.data) : null),
    [swr.data],
  );

  return { project, isLoading: swr.isLoading, error: swr.error };
}
