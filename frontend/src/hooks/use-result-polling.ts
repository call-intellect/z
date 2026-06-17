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
