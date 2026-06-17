"use client";

import useSWR from "swr";

import { meetingsApi } from "@/api/meetings.api";
import { ApiError } from "@/api/api-error";
import { accessFromApi, type AccessDomain } from "@/domain/meeting";

const REFRESH_INTERVAL_MS = 5_000;

export type UseMeetingAccessResult =
  | { state: "loading"; data: null; error: null }
  | { state: "error"; data: null; error: string }
  | { state: "ready"; data: AccessDomain; error: null };

export function useMeetingAccess(
  meetingId: string | null,
  opts: { enabled?: boolean } = {},
): UseMeetingAccessResult & { mutate: () => void } {
  const enabled = opts.enabled ?? true;

  const { data, error, isLoading, mutate } = useSWR(
    meetingId && enabled ? ["meeting-access", meetingId] : null,
    async ([, id]) => {
      const api = await meetingsApi.access(id);
      return accessFromApi(api);
    },
    {
      refreshInterval: REFRESH_INTERVAL_MS,
      revalidateOnFocus: false,
      shouldRetryOnError: (err) => {
        if (err instanceof ApiError) {
          return err.code !== "unauthorized" && err.code !== "forbidden";
        }
        return true;
      },
    },
  );

  if (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Не удалось получить данные встречи.";
    return {
      state: "error",
      data: null,
      error: message,
      mutate: () => mutate(),
    };
  }
  if (isLoading || !data) {
    return {
      state: "loading",
      data: null,
      error: null,
      mutate: () => mutate(),
    };
  }
  return { state: "ready", data, error: null, mutate: () => mutate() };
}
