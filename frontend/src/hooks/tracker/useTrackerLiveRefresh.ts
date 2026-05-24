'use client';

/**
 * useTrackerLiveRefresh — подписка на live-события трекера c автоматическим
 * вызовом `mutate()` соответствующих SWR-ключей.
 *
 * Используется поверх `useTrackerWebSocket` (одно соединение per Org) — этот
 * хук берёт client из контекста родителя ИЛИ создаёт собственный.
 *
 * Каждый event-type маппится на список SWR-keys, которые нужно ре-валидировать
 * — мы выбрали global `mutate` (из 'swr'), чтобы можно было дёргать ключи
 * любых других хуков (issue, issues, cycle, cycles, comments, ...).
 *
 * Анти-шторм: при шквале событий (например, мигалка статусов) делаем
 * debounced refresh — не чаще раза в N мс на ключ.
 */

import { useEffect } from 'react';
import { mutate as swrMutate } from 'swr';

import type { TrackerWsEventType } from '@/domain/tracker';

import { useTrackerWebSocket } from './useTrackerWebSocket';

/** Debounce окно — чтобы шквал событий не порождал столько же fetch'ей. */
const REFRESH_DEBOUNCE_MS = 150;

/** Опции — позволяют дополнительно подписаться на конкретный project/issue room. */
export interface TrackerLiveRefreshOptions {
  /** Если задан — клиент join'нет project room для узких событий. */
  projectId?: string | null;
  /** Если задан — клиент join'нет issue room. */
  issueId?: string | null;
}

/**
 * Подписывается на события трекера и вызывает global SWR `mutate(prefix)`
 * для затронутых ключей.
 *
 * SWR-ключи в хуках трекера — массивы вида `['tracker.<resource>', ...]`.
 * Маппинг event → ключ-префикс:
 *   - issue.*        → 'tracker.issues' (список) + 'tracker.issue' (одна)
 *                       + 'tracker.issue.activity'
 *   - comment.*      → 'tracker.issue.comments'
 *   - cycle.*        → 'tracker.cycles' + 'tracker.cycle'
 *   - intake.*       → 'tracker.intake'
 *   - activity_feed.* → 'tracker.activity-feed' (если такой хук появится)
 */
export function useTrackerLiveRefresh(
  orgId: string | null | undefined,
  options: TrackerLiveRefreshOptions = {},
  enabled: boolean = true,
): { connected: boolean } {
  const { client, connected } = useTrackerWebSocket(orgId, enabled);
  const { projectId, issueId } = options;

  // ── Узкие подписки (project / issue rooms) ─────────────────────────
  useEffect(() => {
    if (!client || !projectId) return;
    void client.subscribeProject(projectId);
    return () => {
      void client.unsubscribeProject(projectId);
    };
  }, [client, projectId]);

  useEffect(() => {
    if (!client || !issueId) return;
    void client.subscribeIssue(issueId);
    return () => {
      void client.unsubscribeIssue(issueId);
    };
  }, [client, issueId]);

  // ── Подписка на типы событий → SWR mutate ──────────────────────────
  useEffect(() => {
    if (!client) return;

    // Debouncer per key-prefix. Не используем lodash — простая Map таймеров.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const refreshDebounced = (keyPrefix: string): void => {
      const existing = timers.get(keyPrefix);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(keyPrefix);
        // global `mutate` принимает функцию-предикат, которая фильтрует ключи.
        void swrMutate(
          (key: unknown) =>
            Array.isArray(key) &&
            typeof key[0] === 'string' &&
            key[0] === keyPrefix,
          undefined,
          { revalidate: true },
        );
      }, REFRESH_DEBOUNCE_MS);
      timers.set(keyPrefix, t);
    };

    const handlers: Array<() => void> = [];

    const subscribe = (
      eventType: TrackerWsEventType,
      keyPrefixes: string[],
    ): void => {
      const off = client.on(eventType, () => {
        for (const prefix of keyPrefixes) refreshDebounced(prefix);
      });
      handlers.push(off);
    };

    // issue.*
    subscribe('issue.created', ['tracker.issues']);
    subscribe('issue.updated', [
      'tracker.issues',
      'tracker.issue',
      'tracker.issue.activity',
    ]);
    subscribe('issue.deleted', ['tracker.issues', 'tracker.issue']);

    // comment.*
    subscribe('comment.created', [
      'tracker.issue.comments',
      'tracker.issue.activity',
    ]);
    subscribe('comment.updated', ['tracker.issue.comments']);
    subscribe('comment.deleted', [
      'tracker.issue.comments',
      'tracker.issue.activity',
    ]);

    // cycle.*
    subscribe('cycle.created', ['tracker.cycles']);
    subscribe('cycle.progress_updated', ['tracker.cycles', 'tracker.cycle']);
    subscribe('cycle.completed', ['tracker.cycles', 'tracker.cycle']);

    // intake.*
    subscribe('intake.new_item', ['tracker.intake']);
    subscribe('intake.triaged', ['tracker.intake', 'tracker.issues']);

    // activity_feed.*  (опц., если когда-то появится хук)
    subscribe('activity_feed.new_item', ['tracker.activity-feed']);

    return () => {
      for (const off of handlers) off();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [client]);

  return { connected };
}
