"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issueTemplatesApi } from "@/api/tracker/templates.api";
import {
  issueTemplateFromApi,
  type IssueTemplate,
} from "@/domain/tracker/recurrence";

export function useIssueTemplates(
  orgId: string | null | undefined,
  projectId?: string | null,
): {
  templates: IssueTemplate[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["tracker.issue-templates", orgId, projectId ?? null]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return issueTemplatesApi.list(orgId, projectId ?? null);
    },
    { revalidateOnFocus: false },
  );

  const templates = useMemo<IssueTemplate[]>(
    () => (swr.data ? swr.data.map(issueTemplateFromApi) : []),
    [swr.data],
  );

  return {
    templates,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
