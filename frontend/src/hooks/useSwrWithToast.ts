'use client';

/**
 * useSwrWithToast — обёртка над useSWR, которая при ошибке загрузки
 * автоматически показывает sonner-toast. Шов для унификации UX:
 * страница больше не дублирует `if (error) toast(...)` руками.
 *
 * Сигнатура совпадает с useSWR — возвращаемое значение прозрачно проброшено.
 */

import { useEffect, useRef } from 'react';
import useSWR, { type Key, type SWRConfiguration, type SWRResponse } from 'swr';
import { toast } from '@/ui/shadcn/toast';

type Fetcher<Data> = (...args: unknown[]) => Promise<Data> | Data;

export type UseSwrWithToastOptions<Data, Err> = SWRConfiguration<Data, Err> & {
  /** Текст ошибки. По умолчанию — «Не удалось загрузить данные». */
  errorTitle?: string;
  /** Если true — ошибка молча проглатывается (для фоновых запросов). */
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
    const title = errorTitle ?? 'Не удалось загрузить данные';
    const description =
      result.error instanceof Error ? result.error.message : undefined;
    toast.error(title, description ? { description } : undefined);
  }, [result.error, errorTitle, silent]);

  return result;
}
