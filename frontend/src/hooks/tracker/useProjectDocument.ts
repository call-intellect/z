"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { projectDocumentsApi } from "@/api/tracker/project-documents.api";
import { projectDocumentFromApi, type ProjectDocument } from "@/domain/tracker";

export function useProjectDocument(
  orgId: string | null | undefined,
  documentId: string | null | undefined,
): {
  document: ProjectDocument | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && documentId
      ? ["tracker.project-document", orgId, documentId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !documentId) throw new Error("orgId/documentId required");
      return projectDocumentsApi.byId(orgId, documentId);
    },
    { revalidateOnFocus: false },
  );

  const document = useMemo<ProjectDocument | null>(
    () => (swr.data ? projectDocumentFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    document,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
