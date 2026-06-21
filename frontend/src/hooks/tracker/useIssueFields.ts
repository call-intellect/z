"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { issueFieldsApi } from "@/api/tracker/issue-fields.api";
import {
  issueFieldDefFromApi,
  issueFieldValueFromApi,
  type IssueFieldDef,
  type IssueFieldValue,
} from "@/domain/tracker";

export function useIssueFieldDefs(
  orgId: string | null | undefined,
  projectId?: string | null,
): {
  defs: IssueFieldDef[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["tracker.issue-field-defs", orgId, projectId ?? null]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return issueFieldsApi.listDefs(orgId, projectId ?? null);
    },
    { revalidateOnFocus: false },
  );

  const defs = useMemo<IssueFieldDef[]>(
    () => (swr.data ? swr.data.map(issueFieldDefFromApi) : []),
    [swr.data],
  );

  return {
    defs,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

export function useIssueFieldValues(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): {
  values: IssueFieldValue[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && issueId
      ? ["tracker.issue-field-values", orgId, issueId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !issueId) throw new Error("orgId/issueId required");
      return issueFieldsApi.listValues(orgId, issueId);
    },
    { revalidateOnFocus: false },
  );

  const values = useMemo<IssueFieldValue[]>(
    () => (swr.data ? swr.data.map(issueFieldValueFromApi) : []),
    [swr.data],
  );

  return {
    values,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
