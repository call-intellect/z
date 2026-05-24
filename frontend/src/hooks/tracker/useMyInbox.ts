'use client';

/**
 * useMyInbox — мои задачи (assignee=me) во всех проектах.
 *
 * ⚠ TODO Sprint 3+: специальный endpoint `GET /api/v1/me/inbox` ещё не
 * реализован на backend. Пока возвращаем пустой массив + isLoading=false,
 * чтобы страница `/me/inbox` рендерилась с EmptyState. Когда endpoint
 * появится — здесь заменить тело на реальный SWR-вызов.
 */

import type { Issue } from '@/domain/tracker';

export function useMyInbox(_orgId: string | null | undefined): {
  issues: Issue[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
  todo: true;
} {
  return {
    issues: [],
    error: null,
    isLoading: false,
    mutate: async () => undefined,
    todo: true,
  };
}
