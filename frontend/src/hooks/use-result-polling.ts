"use client";

import useSWR from "swr";

import { meetingsApi, type ResultApiResponse } from "@/api/meetings.api";
import { ApiError } from "@/api/api-error";
import type { MeetingStatus } from "@/domain/enums";

const POLL_MS = 5_000;

export type ResultStage =
  | "recording_processing"
  | "transcription_processing"
  | "ai_processing"
  | "recording_ready"
  | "transcription_ready"
  | "ai_ready"
  | "failed"
  | "ai_failed"
  | "other";

function toStage(status: MeetingStatus): ResultStage {
  switch (status) {
    case "recording_processing":
    case "transcription_processing":
    case "ai_processing":
    case "recording_ready":
    case "transcription_ready":
    case "ai_ready":
    case "failed":
    case "ai_failed":
      return status;
    default:
      return "other";
  }
}

export function isTerminalFailureStage(
  stage: ResultStage,
): stage is "failed" | "ai_failed" {
  return stage === "failed" || stage === "ai_failed";
}

export type UseResultResult =
  | { state: "loading"; data: null; error: null; mutate: () => void }
  | { state: "error"; data: null; error: string; mutate: () => void }
  | {
      state: "progress";
      stage: ResultStage;
      data: ResultApiResponse;
      error: null;
      mutate: () => void;
    }
  | {
      state: "failed";
      stage: "failed" | "ai_failed";
      data: ResultApiResponse;
      error: string | null;
      mutate: () => void;
    }
  | {
      state: "ready";
      stage: "ai_ready";
      data: ResultApiResponse;
      error: null;
      mutate: () => void;
    };

export function useResultPolling(meetingId: string | null): UseResultResult {
  const { data, error, isLoading, mutate } = useSWR(
    meetingId ? ["result", meetingId] : null,
    async ([, id]) => meetingsApi.result(id),
    {
      refreshInterval: (latest) => {
        if (!latest) return POLL_MS;
        if (latest.aiReady) return 0;
        if (isTerminalFailureStage(toStage(latest.meeting.status))) return 0;
        return POLL_MS;
      },
      revalidateOnFocus: false,
      shouldRetryOnError: (err) =>
        !(
          err instanceof ApiError &&
          (err.code === "unauthorized" || err.code === "forbidden")
        ),
    },
  );

  const refresh = () => mutate();

  if (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Не удалось получить результат.";
    return { state: "error", data: null, error: message, mutate: refresh };
  }
  if (isLoading || !data) {
    return { state: "loading", data: null, error: null, mutate: refresh };
  }
  const stage = toStage(data.meeting.status);
  if (isTerminalFailureStage(stage)) {
    return {
      state: "failed",
      stage,
      data,
      error: data.meeting.failureReason ?? null,
      mutate: refresh,
    };
  }
  if (stage === "ai_ready" && data.aiResult) {
    return {
      state: "ready",
      stage: "ai_ready",
      data,
      error: null,
      mutate: refresh,
    };
  }
  return { state: "progress", stage, data, error: null, mutate: refresh };
}
