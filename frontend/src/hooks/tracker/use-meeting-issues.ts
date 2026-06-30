"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issuesApi } from "@/api/tracker/issues.api";
import { issueFromApi, type Issue } from "@/domain/tracker";

export function useMeetingIssues(
  orgId: string | null | undefined,
  meetingId: string | null | undefined,
): {
  issues: Issue[];
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && meetingId ? ["meeting-issues", orgId, meetingId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !meetingId) throw new Error("orgId and meetingId required");
      return issuesApi.listOrg(orgId, { linkedMeetingId: meetingId });
    },
    { revalidateOnFocus: false },
  );

  const issues = useMemo<Issue[]>(
    () => (swr.data?.items ? swr.data.items.map(issueFromApi) : []),
    [swr.data],
  );

  return {
    issues,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
