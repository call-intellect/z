"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { meetingReportsApi } from "@/api/meeting-reports.api";
import {
  availableTemplateFromApi,
  hasInProgress,
  reportListItemFromApi,
  type AvailableTemplateDomain,
  type ReportListItemDomain,
} from "@/domain/meeting-report";

export function useMeetingReports(meetingId: string | null | undefined): {
  reports: ReportListItemDomain[];
  isLoading: boolean;
  error: unknown;
  mutate: () => void;
} {
  const swr = useSWR(
    meetingId ? ["meeting-reports", meetingId] : null,
    async () => {
      if (!meetingId) throw new Error("meetingId is required");
      return meetingReportsApi.list(meetingId);
    },
    {
      refreshInterval: (latest) => {
        if (!latest) return 5_000;
        const items = latest.map(reportListItemFromApi);
        return hasInProgress(items) ? 5_000 : 0;
      },
      revalidateOnFocus: false,
    },
  );

  const reports = useMemo(
    () => (swr.data ? swr.data.map(reportListItemFromApi) : []),
    [swr.data],
  );

  return {
    reports,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => {
      void swr.mutate();
    },
  };
}

export function useAvailableReportTemplates(
  meetingId: string | null | undefined,
  enabled = true,
): {
  templates: AvailableTemplateDomain[];
  isLoading: boolean;
  error: unknown;
} {
  const swr = useSWR(
    meetingId && enabled ? ["meeting-reports-templates", meetingId] : null,
    async () => {
      if (!meetingId) throw new Error("meetingId is required");
      return meetingReportsApi.availableTemplates(meetingId);
    },
    { revalidateOnFocus: false },
  );

  const templates = useMemo(
    () => (swr.data ? swr.data.map(availableTemplateFromApi) : []),
    [swr.data],
  );

  return {
    templates,
    isLoading: swr.isLoading,
    error: swr.error,
  };
}
