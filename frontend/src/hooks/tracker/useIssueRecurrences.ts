"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issueRecurrencesApi } from "@/api/tracker/recurrences.api";
import {
  issueRecurrenceFromApi,
  type IssueRecurrence,
} from "@/domain/tracker/recurrence";

export function useIssueRecurrences(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): {
  recurrences: IssueRecurrence[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && projectId
      ? ["tracker.issue-recurrences", orgId, projectId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return issueRecurrencesApi.list(orgId, projectId);
    },
    { revalidateOnFocus: false },
  );

  const recurrences = useMemo<IssueRecurrence[]>(
    () => (swr.data ? swr.data.map(issueRecurrenceFromApi) : []),
    [swr.data],
  );

  return {
    recurrences,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
