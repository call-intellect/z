"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { automationRulesApi } from "@/api/tracker/automation-rules.api";
import {
  automationRuleFromApi,
  type AutomationRule,
} from "@/domain/tracker/automation-rule";

export function useAutomationRules(
  orgId: string | null | undefined,
  projectId?: string | null,
): {
  rules: AutomationRule[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId
    ? ["tracker.automation-rules", orgId, projectId ?? null]
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error("orgId required");
      return automationRulesApi.list(orgId, projectId ?? null);
    },
    { revalidateOnFocus: false },
  );

  const rules = useMemo<AutomationRule[]>(
    () => (swr.data ? swr.data.map(automationRuleFromApi) : []),
    [swr.data],
  );

  return {
    rules,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
