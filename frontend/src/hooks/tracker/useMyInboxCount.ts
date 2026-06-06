'use client';

/**
 * useMyInboxCount — точный счётчик задач в личном инбоксе для бейджа
 * на иконке «Инбокс» в `TrackerBottomNav`.
 *
 * Wave 1 T6-6a: backend теперь предоставляет `GET /api/v1/me/inbox/count`
 * который возвращает `{ total, unread }`. Хук использует его напрямую —
 * больше не нужен workaround через `myInbox({ limit: 1 })`.
 *
 * Кэш — отдельный SWR-ключ `me.inbox.count`. Live-обновление через
 * `useTrackerLiveRefresh` (issue.* / intake.triaged).
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';
import { BADGE_DEDUPE_MS } from '@/lib/badge-polling';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export interface UseMyInboxCountResult {
  /** Общее число задач в инбоксе. */
  count: number;
  /** Общее число (синоним count). */
  total: number;
  /** Число непрочитанных задач (если backend поддерживает IssueRead — иначе равно total). */
  unread: number;
  /** true если в инбоксе есть хотя бы одна задача. */
  hasUnread: boolean;
  isLoading: boolean;
  error: unknown;
  mutate: () => Promise<unknown>;
}

export function useMyInboxCount(
  orgId: string | null | undefined,
): UseMyInboxCountResult {
  const key = orgId ? (['me.inbox.count', orgId] as const) : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return issuesApi.myInboxCount(orgId);
    },
    { revalidateOnFocus: true, dedupingInterval: BADGE_DEDUPE_MS },
  );

  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const { total, unread } = useMemo(() => {
    if (!swr.data) return { total: 0, unread: 0 };
    return { total: swr.data.total, unread: swr.data.unread };
  }, [swr.data]);

  return {
    count: total,
    total,
    unread,
    hasUnread: unread > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
