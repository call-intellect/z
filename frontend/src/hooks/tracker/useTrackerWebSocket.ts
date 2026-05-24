'use client';

/**
 * useTrackerWebSocket — подписка на live-события трекера (`/ws/tracker`).
 *
 * Backend использует socket.io (см. `backend/src/modules/tracker/gateways/
 * tracker.gateway.ts`), но в frontend нет `socket.io-client` в зависимостях,
 * а правила Sprint 2 запрещают добавлять зависимости без явной нужды.
 *
 * ⚠ TODO Sprint 3: подключить socket.io-client и реализовать:
 *   - handshake с `auth.token = cookie z_session` (для server-side cookies
 *     передаём через `withCredentials: true` + handshake.auth.tenantId).
 *   - подписка на rooms `project:${id}` и `issue:${id}` через subscribe.project
 *     / subscribe.issue.
 *   - EventEmitter / Subject — внешним подписчикам отдаём поток `TrackerWsEvent`.
 *   - heartbeat / reconnect: socket.io уже умеет.
 *
 * Сейчас хук возвращает no-op объект, чтобы UI можно было собрать.
 */

import { useEffect, useRef } from 'react';
import type { TrackerWsEventType } from '@/domain/tracker';

export interface TrackerWsClient {
  /** Подписаться на конкретный тип события (после соединения). */
  on: (eventType: TrackerWsEventType, handler: (payload: unknown) => void) => () => void;
  /** Подписаться на room проекта (server-side join). */
  subscribeProject: (projectId: string) => Promise<void>;
  unsubscribeProject: (projectId: string) => Promise<void>;
  subscribeIssue: (issueId: string) => Promise<void>;
  unsubscribeIssue: (issueId: string) => Promise<void>;
  /** Закрыть соединение. */
  close: () => void;
}

export function useTrackerWebSocket(
  _orgId: string | null | undefined,
  _enabled: boolean = true,
): { client: TrackerWsClient | null; connected: boolean; todo: true } {
  const clientRef = useRef<TrackerWsClient | null>(null);

  useEffect(() => {
    // TODO Sprint 3 — реальное socket.io подключение.
    clientRef.current = {
      on: () => () => undefined,
      subscribeProject: async () => undefined,
      unsubscribeProject: async () => undefined,
      subscribeIssue: async () => undefined,
      unsubscribeIssue: async () => undefined,
      close: () => undefined,
    };
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  return {
    client: clientRef.current,
    connected: false,
    todo: true,
  };
}
