"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { projectDocumentsApi } from "@/api/tracker/project-documents.api";
import {
  projectDocumentSummaryFromApi,
  type ProjectDocumentSummary,
} from "@/domain/tracker";

export function useProjectDocuments(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  documents: ProjectDocumentSummary[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId ? ["tracker.project.documents", orgId, projectId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return projectDocumentsApi.listByProject(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const documents = useMemo<ProjectDocumentSummary[]>(
    () => (swr.data ? swr.data.map(projectDocumentSummaryFromApi) : []),
    [swr.data],
  );

  return {
    documents,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
