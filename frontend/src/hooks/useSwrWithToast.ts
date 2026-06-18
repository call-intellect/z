"use client";

import { useEffect, useRef } from "react";
import useSWR, { type Key, type SWRConfiguration, type SWRResponse } from "swr";
import { toast } from "@/ui/shadcn/toast";
import { humanizeApiError } from "@/api/api-error";

type Fetcher<Data> = (...args: unknown[]) => Promise<Data> | Data;

export type UseSwrWithToastOptions<Data, Err> = SWRConfiguration<Data, Err> & {
  errorTitle?: string;
  silent?: boolean;
};

export function useSwrWithToast<Data = unknown, Err = unknown>(
  key: Key,
  fetcher: Fetcher<Data> | null,
  options?: UseSwrWithToastOptions<Data, Err>,
): SWRResponse<Data, Err> {
  const { errorTitle, silent, ...swrOptions } = options ?? {};
  const result = useSWR<Data, Err>(key, fetcher as never, swrOptions);
  const lastErrorRef = useRef<unknown>(null);

  useEffect(() => {
    if (!result.error) {
      lastErrorRef.current = null;
      return;
    }
    if (silent) return;
    if (lastErrorRef.current === result.error) return;
    lastErrorRef.current = result.error;
    const title = errorTitle ?? "Не удалось загрузить данные";
    const description = humanizeApiError(result.error, "");
    toast.error(title, description ? { description } : undefined);
  }, [result.error, errorTitle, silent]);

  return result;
}
