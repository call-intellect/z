'use client';

import { useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { orgsApi } from '@/api/orgs.api';

/**
 * Минимальный helper: получить ID текущей Org для org-admin вызовов.
 *
 * На Фазе 7 multi-org-выбора нет — у юзера обычно одна Org. Берём первую
 * из `orgsApi.listMine()`. Для multi-org (vNext) — переехать на org-switcher.
 *
 * Возвращает `null` пока загружается, и `undefined` если Org нет (юзер без
 * Membership). На основе этого UI решает: показать loading / empty / контент.
 */
export function useCurrentOrgId(): {
  orgId: string | null | undefined;
  isLoading: boolean;
  error: string | null;
} {
  const [orgId, setOrgId] = useState<string | null | undefined>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await orgsApi.listMine();
        if (cancelled) return;
        setOrgId(res.orgs[0]?.id ?? undefined);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { orgId, isLoading, error };
}
