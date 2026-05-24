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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { issuesApi, type MyInboxRequest } from '@/api/tracker/issues.api';
import {
  issueFromApi,
  type Issue,
  type IssueApi,
  type MyInboxResponseApi,
} from '@/domain/tracker';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export interface UseMyInboxResult {
  issues: Issue[];
  /** Курсор для следующей страницы (`null` если страница последняя). */
  nextCursor: string | null;
  /** Удобный флаг: есть ли ещё страницы. */
  hasMore: boolean;
  limit: number;
  error: unknown;
  /** true только для первичной загрузки (страница 1). */
  isLoading: boolean;
  /** Wave 2 A7: true пока подгружается следующая страница (loadMore в полёте). */
  isLoadingMore: boolean;
  /**
   * Wave 2 A7: запросить следующую страницу и приклеить её к накопленному
   * списку. Безопасно к двойному вызову — повторный клик во время загрузки
   * игнорируется. No-op если страниц больше нет.
   */
  loadMore: () => Promise<void>;
  mutate: () => Promise<unknown>;
}

export function useMyInbox(
  orgId: string | null | undefined,
  req: MyInboxRequest = {},
): UseMyInboxResult {
  // Wave 2 A7: накопленные страницы за пределами первой. SWR кеширует
  // только первую страницу (стабильный ключ). Следующие страницы грузим
  // императивно через issuesApi и складываем в локальный state.
  const [extraItems, setExtraItems] = useState<IssueApi[]>([]);
  const [tailCursor, setTailCursor] = useState<string | null>(null);
  const [tailExhausted, setTailExhausted] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadInFlight = useRef(false);

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

  const swr = useSWR<MyInboxResponseApi>(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return issuesApi.myInbox(orgId, req);
    },
    { revalidateOnFocus: false },
  );

  // Когда первая страница перезагружается (live-event, ручной mutate,
  // смена фильтров) — сбрасываем накопленный хвост: иначе он расходится
  // с обновлённой первой страницей и могут появиться дубли/устаревшие.
  useEffect(() => {
    setExtraItems([]);
    setTailCursor(null);
    setTailExhausted(false);
  }, [swr.data]);

  // Live-обновление: любые события issue.* / intake.triaged в этой
  // организации могут изменить инбокс.
  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const firstPageCursor = swr.data?.nextCursor ?? null;

  const issues = useMemo<Issue[]>(() => {
    const firstPageItems = swr.data?.items ?? [];
    return [...firstPageItems, ...extraItems].map(issueFromApi);
  }, [swr.data, extraItems]);

  // Эффективный «следующий курсор»: если хвост уже подгружен — берём из
  // последнего ответа хвоста, иначе — из первой страницы.
  const effectiveNextCursor = extraItems.length > 0 ? tailCursor : firstPageCursor;
  const effectiveHasMore = tailExhausted
    ? false
    : effectiveNextCursor !== null;

  const loadMore = useCallback(async () => {
    if (!orgId) return;
    if (loadInFlight.current) return;
    if (!effectiveHasMore) return;
    if (!effectiveNextCursor) return;

    loadInFlight.current = true;
    setIsLoadingMore(true);
    try {
      const res = await issuesApi.myInbox(orgId, {
        ...req,
        cursor: effectiveNextCursor,
      });
      setExtraItems((prev) => [...prev, ...res.items]);
      setTailCursor(res.nextCursor);
      if (res.nextCursor === null) setTailExhausted(true);
    } finally {
      loadInFlight.current = false;
      setIsLoadingMore(false);
    }
    // req объект пересоздаётся каждый рендер — берём важные поля через JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, effectiveHasMore, effectiveNextCursor, JSON.stringify(req)]);

  return {
    issues,
    nextCursor: effectiveNextCursor,
    hasMore: effectiveHasMore,
    limit: swr.data?.limit ?? (req.limit ?? 50),
    error: swr.error,
    isLoading: swr.isLoading,
    isLoadingMore,
    loadMore,
    mutate: () => swr.mutate(),
  };
}
