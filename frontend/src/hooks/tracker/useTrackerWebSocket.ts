'use client';

/**
 * useTrackerWebSocket — подписка на live-события трекера (`/ws/tracker`).
 *
 * Backend: см. `backend/src/modules/tracker/gateways/tracker.gateway.ts`
 * (socket.io namespace `/ws/tracker`, события называются как `event.type`:
 * `issue.created`, `issue.updated`, `comment.created` и т.д.).
 *
 * Контракт frontend:
 *   - one connection per orgId (хук пересоздаёт socket при смене tenant);
 *   - withCredentials: true — отправляем cookie `z_session`;
 *   - handshake.auth.tenantId = orgId — гейт-вэй ставит клиента в
 *     основной room `tenant:<tenantId>`;
 *   - subscribeProject / subscribeIssue — дополнительный server-side join
 *     в room проекта/задачи (через emit + ack);
 *   - on(eventType, handler) — внутренний EventEmitter; возвращает unsubscribe.
 *
 * Heartbeat и reconnect — встроенные в socket.io.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type { TrackerWsEventType } from '@/domain/tracker';

/** Все известные имена событий (зеркало backend `TrackerWsEvent.type`). */
const KNOWN_EVENT_TYPES: TrackerWsEventType[] = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'cycle.created',
  'cycle.updated',
  'cycle.progress_updated',
  'cycle.completed',
  'intake.new_item',
  'intake.triaged',
  'activity_feed.new_item',
  // Wave 3 / Tracker Phase 5 part 1 — события миграционного wizard'а.
  'import.progress',
  'import.completed',
  'import.failed',
  // ТЗ 2026-05-28 sprints master-detail — события подсказок помощника.
  'sprint_hint.created',
  'sprint_hint.updated',
  'sprint_hint.dismissed',
  'sprint_hint.resolved',
];

export interface TrackerWsClient {
  /** Подписаться на конкретный тип события. Возвращает unsubscribe. */
  on: (eventType: TrackerWsEventType, handler: (payload: unknown) => void) => () => void;
  /** Подписаться на room проекта (server-side join). */
  subscribeProject: (projectId: string) => Promise<void>;
  unsubscribeProject: (projectId: string) => Promise<void>;
  subscribeIssue: (issueId: string) => Promise<void>;
  unsubscribeIssue: (issueId: string) => Promise<void>;
  /** Закрыть соединение. */
  close: () => void;
  /**
   * T8 (2026-05-24): сырой socket для узких потребителей (presence/typing
   * в IssueComments). Через него можно emit'ить кастомные имена событий
   * (`issue.chat.join` и т.п.), не расширяя «типизированный» API клиента
   * для каждого нового сценария. Не использовать для основных событий
   * (`issue.*` / `comment.*` и т.п.) — для них есть on/subscribeIssue.
   */
  __socket: Socket;
}

/**
 * Базовый URL WebSocket-соединения.
 * Приоритет: NEXT_PUBLIC_WS_URL → NEXT_PUBLIC_API_BASE_URL → window.location.origin.
 * Backend slушает на :3000, frontend dev — на :3001, поэтому fallback на
 * window.location.origin без явного API URL приведёт к ошибке коннекта.
 */
function resolveWsUrl(): string {
  const wsEnv =
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_WS_URL ?? '').trim();
  if (wsEnv && wsEnv.length > 0) {
    return wsEnv.replace(/\/+$/, '') + '/ws/tracker';
  }
  const apiEnv =
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim();
  if (apiEnv && apiEnv.length > 0) {
    return apiEnv.replace(/\/+$/, '') + '/ws/tracker';
  }
  // Прод same-origin или SSR.
  if (typeof window !== 'undefined') {
    return window.location.origin + '/ws/tracker';
  }
  return '/ws/tracker';
}

export function useTrackerWebSocket(
  orgId: string | null | undefined,
  enabled: boolean = true,
): { client: TrackerWsClient | null; connected: boolean } {
  // Внешний state — для UI индикатора «онлайн».
  const [connected, setConnected] = useState(false);
  // Стабильная ссылка на client (пере-создаётся при смене orgId).
  const clientRef = useRef<TrackerWsClient | null>(null);
  const [, setClientVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !orgId || typeof window === 'undefined') {
      clientRef.current = null;
      setConnected(false);
      return;
    }

    const url = resolveWsUrl();

    // namespace = '/ws/tracker'. Передаём через путь URL.
    // `withCredentials` — гарантирует, что браузер пошлёт cookie `z_session`
    // (HTTP-only, ставит backend при логине).
    const socket: Socket = io(url, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: { tenantId: orgId },
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    // ── EventEmitter поверх Socket ────────────────────────────────────
    // Внутренние подписчики: Map<eventType, Set<handler>>.
    const subscribers = new Map<
      TrackerWsEventType,
      Set<(payload: unknown) => void>
    >();

    // Шину делаем «толстой»: подписываемся на все известные имена событий
    // и фанаутом раздаём подписчикам. Так UI-хуки могут регистрироваться
    // даже ДО первого реального события, без race-condition.
    const fanout = (eventType: TrackerWsEventType) => (payload: unknown) => {
      const set = subscribers.get(eventType);
      if (!set || set.size === 0) return;
      for (const handler of set) {
        try {
          handler(payload);
        } catch (err) {
          console.warn(`[tracker-ws] handler for ${eventType} threw:`, err);
        }
      }
    };

    for (const eventType of KNOWN_EVENT_TYPES) {
      socket.on(eventType, fanout(eventType));
    }

    // ── lifecycle ─────────────────────────────────────────────────────
    socket.on('connect', () => {
      setConnected(true);
    });
    socket.on('disconnect', () => {
      setConnected(false);
    });
    socket.on('connect_error', (err: Error) => {
      console.warn('[tracker-ws] connect_error:', err.message);
    });

    // ── client API ────────────────────────────────────────────────────
    const emitWithAck = <T>(eventName: string, body: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const TIMEOUT_MS = 5000;
        let settled = false;
        const t = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`ack timeout for ${eventName}`));
        }, TIMEOUT_MS);
        socket.emit(eventName, body, (ack: T) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(t);
          resolve(ack);
        });
      });

    const client: TrackerWsClient = {
      on(eventType, handler) {
        let set = subscribers.get(eventType);
        if (!set) {
          set = new Set();
          subscribers.set(eventType, set);
        }
        set.add(handler);
        return () => {
          set?.delete(handler);
        };
      },
      async subscribeProject(projectId) {
        try {
          await emitWithAck<{ ok: boolean; error?: string }>(
            'subscribe.project',
            { projectId },
          );
        } catch (err) {
          console.warn('[tracker-ws] subscribeProject failed:', err);
        }
      },
      async unsubscribeProject(projectId) {
        try {
          await emitWithAck<{ ok: boolean }>('unsubscribe.project', {
            projectId,
          });
        } catch {
          /* fire-and-forget */
        }
      },
      async subscribeIssue(issueId) {
        try {
          await emitWithAck<{ ok: boolean; error?: string }>(
            'subscribe.issue',
            { issueId },
          );
        } catch (err) {
          console.warn('[tracker-ws] subscribeIssue failed:', err);
        }
      },
      async unsubscribeIssue(issueId) {
        try {
          await emitWithAck<{ ok: boolean }>('unsubscribe.issue', { issueId });
        } catch {
          /* fire-and-forget */
        }
      },
      close() {
        socket.disconnect();
      },
      __socket: socket,
    };

    clientRef.current = client;
    // Сообщаем потребителям, что client появился (иначе они увидят null,
    // пока не произойдёт следующий render).
    setClientVersion((v) => v + 1);

    return () => {
      subscribers.clear();
      socket.removeAllListeners();
      socket.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
  }, [orgId, enabled]);

  // useMemo не использует clientRef.current напрямую (ref не вызывает
  // ре-рендер), но за счёт setClientVersion компонент уже перерендерился.
  return useMemo(
    () => ({ client: clientRef.current, connected }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connected, clientRef.current],
  );
}
