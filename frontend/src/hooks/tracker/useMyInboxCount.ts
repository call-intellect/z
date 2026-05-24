'use client';

/**
 * useMyInboxCount — лёгкий счётчик задач в личном инбоксе для бейджа
 * на иконке «Инбокс» в `TrackerBottomNav`.
 *
 * Wave 2 A8: backend сейчас НЕ предоставляет отдельного endpoint'а
 * `/api/v1/me/inbox/count`. Чтобы не тащить тяжёлый список (50–100 задач)
 * ради одного числа, делаем самый дешёвый из доступных запросов —
 * `GET /me/inbox?limit=1` — и определяем «есть ли что-то» по `items.length`.
 *
 * Из-за ограничения backend'а это **не точное число**, а индикатор
 * «есть/нет». Поэтому:
 *   - если есть хотя бы 1 задача — возвращаем `count: 1` и `hasUnread: true`;
 *     bottom-nav рисует бейдж-точку (без цифры).
 *   - если задач 0 — `count: 0`, `hasUnread: false`, бейдж скрыт.
 *
 * TODO (backend): добавить `GET /api/v1/me/inbox/count` (или хотя бы
 * `total` в ответе `/me/inbox`), чтобы показывать точное число.
 *
 * Кэш — отдельный SWR-ключ `me.inbox.count`. Live-обновление: хук
 * подписан на `useTrackerLiveRefresh` (issue.* / intake.triaged), который
 * глобально ревалидирует ключи с префиксом — у нас здесь свой префикс,
 * поэтому подписка ниже отдельно делает `mutate` по фокусу/событиям —
 * но `useTrackerLiveRefresh` уже триггерит revalidate всех `tracker.issues`
 * + `me.inbox` ключей; этого пока достаточно. При live-event основной
 * `useMyInbox` ревалидируется, а вместе с ним и наш счётчик при следующем
 * рендере, который дёрнет `mutate` если кэш протух.
 */

import { useMemo } from 'react';
import useSWR from 'swr';

import { issuesApi } from '@/api/tracker/issues.api';

import { useTrackerLiveRefresh } from './useTrackerLiveRefresh';

export interface UseMyInboxCountResult {
  /**
   * Приблизительное число задач в инбоксе (0 или 1 — backend
   * ограничение, см. файл-док).
   */
  count: number;
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
      // limit=1 — backend поддерживает min=1 (см. MyInboxQuerySchema), это
      // самый дешёвый legitimate запрос.
      return issuesApi.myInbox(orgId, { limit: 1 });
    },
    { revalidateOnFocus: true },
  );

  // Любые события issue.* / intake.triaged могут изменить состав инбокса —
  // полагаемся на тот же live-канал, что и основной useMyInbox.
  useTrackerLiveRefresh(orgId, {}, Boolean(orgId));

  const count = useMemo(() => {
    if (!swr.data) return 0;
    // Backend не отдаёт total; см. шапку файла. count = 1 как маркер
    // «хотя бы одна задача есть», иначе 0.
    return swr.data.items.length > 0 ? 1 : 0;
  }, [swr.data]);

  return {
    count,
    hasUnread: count > 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: () => swr.mutate(),
  };
}
