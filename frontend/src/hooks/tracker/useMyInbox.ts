'use client';

/**
 * useMyInbox — мои задачи (assignee = текущий пользователь) во всех проектах
 * текущей организации.
 *
 * Источник: `GET /api/v1/me/inbox` с cursor-based пагинацией. Backend контракт:
 *   - `backend/src/modules/tracker/controllers/me-inbox.controller.ts`
 *   - `backend/src/modules/tracker/dto/issues/my-inbox-query.dto.ts`
 *
 * Пагинация — курсорная: для следующей страницы передавай `cursor=nextCursor`
 * из ответа. `hasMore` — производный флаг (`nextCursor !== null`).
 *
 * Live-обновление: подписка на `issue.*` и `intake.triaged` через
 * `useTrackerLiveRefresh` — на любое событие нужного типа SWR ре-валидирует
 * список (общий префикс `tracker.issues` тоже триггерит revalidate, но у
 * `useMyInbox` собственный префикс ключа — поэтому добавляем отдельный
 * хендлер ниже не нужно: глобальный `mutate` с предикатом по префиксу
 * `me.inbox` сейчас не дёргается. Мы рассчитываем на то, что фокус на
 * странице приведёт к ручному `mutate()` через React-обработчики; если
 * понадобится — добавим в `useTrackerLiveRefresh` префикс `me.inbox`).
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi, type MyInboxRequest } from '@/api/tracker/issues.api';
import { issueFromApi, type Issue } from '@/domain/tracker';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export interface UseMyInboxResult {
  issues: Issue[];
  /** Курсор для следующей страницы (`null` если страница последняя). */
  nextCursor: string | null;
  /** Удобный флаг: есть ли ещё страницы. */
  hasMore: boolean;
  limit: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

export function useMyInbox(
  orgId: string | null | undefined,
  req: MyInboxRequest = {},
): UseMyInboxResult {
  const key = orgId
    ? ([
        'me.inbox',
        orgId,
        req.stateCategory ?? null,
        req.stateId ?? null,
        req.priority ?? null,
        req.projectId ?? null,
        req.labelId ?? null,
        req.cycleId ?? null,
        req.dueBefore ?? null,
        req.dueAfter ?? null,
        req.includeArchived ?? false,
        req.includeDeleted ?? false,
        req.cursor ?? null,
        req.limit ?? 50,
      ] as const)
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return issuesApi.myInbox(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  // Live-обновление: любые события issue.* / intake.triaged в этой
  // организации могут изменить инбокс.
  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const issues = useMemo<Issue[]>(
    () => (swr.data?.items ? swr.data.items.map(issueFromApi) : []),
    [swr.data],
  );

  const nextCursor = swr.data?.nextCursor ?? null;

  return {
    issues,
    nextCursor,
    hasMore: nextCursor !== null,
    limit: swr.data?.limit ?? (req.limit ?? 50),
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
