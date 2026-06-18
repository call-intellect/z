"use client";

import useSWR from "swr";

import {
  tourProgressApi,
  type TourProgressApi,
} from "@/api/users/tour-progress.api";

const SWR_KEY = ["users.me.tour-progress"];

export function useTourProgress(enabled: boolean = true): {
  progress: TourProgressApi | null;
  isLoading: boolean;
  error: unknown;
  mutate: (next?: TourProgressApi) => Promise<unknown>;
} {
  const swr = useSWR<TourProgressApi>(
    enabled ? SWR_KEY : null,
    () => tourProgressApi.get(),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  return {
    progress: swr.data ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: (next?: TourProgressApi) =>
      next === undefined
        ? swr.mutate()
        : swr.mutate(next, { revalidate: false }),
  };
}
