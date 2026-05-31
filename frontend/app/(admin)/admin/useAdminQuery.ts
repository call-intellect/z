'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/api-error';

export type AdminQueryState<T> = {
  data: T | null;
  isLoading: boolean;
  isForbidden: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Минимальный hook для загрузки админ-данных с обработкой 403 (super_admin_required
 * или org_admin_required). Аналог useSWR, но без кэша: каждый раз перезагружаем
 * на refetch / при изменении ключа. Этого достаточно — админка не самый
 * горячий путь, и мы хотим явный контроль (refetch на mutations).
 */
export function useAdminQuery<T>(
  key: string,
  loader: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): AdminQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    setIsLoading(true);
    setIsForbidden(false);
    setError(null);
    try {
      const res = await loader();
      if (cancelRef.current) return;
      setData(res);
    } catch (e) {
      if (cancelRef.current) return;
      if (e instanceof ApiError && e.code === 'forbidden') {
        setIsForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      if (!cancelRef.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    cancelRef.current = false;
    void run();
    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  return { data, isLoading, isForbidden, error, refetch: run };
}
