"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  projectsApi,
  type ListProjectsRequest,
} from "@/api/tracker/projects.api";
import { projectFromApi, type Project } from "@/domain/tracker";

export function useProjects(
  orgId: string | null | undefined,
  req: ListProjectsRequest = {},
): {
  projects: Project[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? [
        "tracker.projects",
        orgId,
        req.includeArchived ?? false,
        req.ownerId ?? null,
        req.q ?? "",
        req.page ?? 1,
        req.limit ?? 50,
      ]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId is required");
      return projectsApi.list(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  const projects = useMemo<Project[]>(
    () => (swr.data?.items ? swr.data.items.map(projectFromApi) : []),
    [swr.data],
  );

  return {
    projects,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
