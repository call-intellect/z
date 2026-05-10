'use client';

import { useAuth } from '@/contexts/auth-context';

/**
 * Helper: получить ID текущей Org для org-admin вызовов из auth-context.
 *
 * `currentOrgId` приходит из `/api/v1/accounts/me` (Фаза 7). Для multi-org
 * (vNext) — заменим на org-switcher.
 *
 * Возвращает `null` пока auth-context загружается, `undefined` если Org нет
 * (юзер без Membership). На основе этого UI решает: loading / empty / контент.
 */
export function useCurrentOrgId(): {
  orgId: string | null | undefined;
  isLoading: boolean;
  error: string | null;
} {
  const { currentOrgId, isLoading } = useAuth();
  return {
    orgId: isLoading ? null : (currentOrgId ?? undefined),
    isLoading,
    error: null,
  };
}
