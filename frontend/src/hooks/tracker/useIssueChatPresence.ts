'use client';

/**
 * useIssueChatPresence — подписка на presence/typing в чате задачи (T8).
 *
 * Использует существующий `useTrackerWebSocket` socket (namespace `/ws/tracker`),
 * подписывается на узкую presence-room `presence:issue:<issueId>` через
 * server-side handler'ы:
 *   - `issue.chat.join`    — серверный join + ack со списком online users.
 *   - `issue.chat.leave`   — серверный leave + broadcast user_left.
 *   - `issue.chat.typing`  — relay в room (с throttle на клиенте).
 *   - `issue.chat.presence` — снимок текущего состояния (для refetch).
 *
 * Подписки на broadcast'ы:
 *   - `presence:user_joined`  → добавить юзера в onlineUsers (по userId, без дублей).
 *   - `presence:user_left`    → удалить.
 *   - `presence:user_typing`  → toggle в typingUsers; auto-clear по таймауту 4s
 *                                (на случай потери `isTyping=false`).
 *
 * Auto-cleanup:
 *   - на unmount/смену issueId — emit `issue.chat.leave` + отписки от событий;
 *   - typing-таймеры очищаются.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import { useTrackerWebSocket } from './useTrackerWebSocket';

export interface ChatPresenceUser {
  userId: string;
  displayName: string;
}

interface PresenceEventPayload {
  issueId: string;
  userId: string;
  displayName: string;
}

interface TypingEventPayload extends PresenceEventPayload {
  isTyping: boolean;
}

interface JoinAck {
  ok: boolean;
  error?: string;
  onlineUsers?: ChatPresenceUser[];
}

/** Сколько ждать без `isTyping=false`, прежде чем автосбросить индикатор. */
const TYPING_AUTO_CLEAR_MS = 4_000;

/** Минимальный интервал между emit'ами typing-сигнала (защита от спама). */
const TYPING_THROTTLE_MS = 300;

/**
 * Тип «приватного» доступа к socket'у. `useTrackerWebSocket` не отдаёт raw socket —
 * для presence нам нужны emit/on, которых нет в TrackerWsClient API. Делаем
 * аккуратно: используем `client.on` для broadcast'ов; emit'им через приватный
 * метод socket'а только потому, что presence — узкий случай для одного
 * экрана (чат задачи). В будущем можно расширить TrackerWsClient.
 *
 * Чтобы не лезть в внутренности, расширим TrackerWsClient в самом хуке через
 * глобально известную convention: namespace тот же, JWT тот же — поэтому
 * мы создаём «партнёрское» соединение в useTrackerWebSocket'е или
 * используем events напрямую. Здесь: используем socket events через
 * `client.on` (это просто шина) + дополнительно `socketEmit` через
 * глобальный singleton. Чтобы избежать второго коннекта, прокидываем
 * необходимые методы в useTrackerWebSocket в виде расширенного API.
 *
 * РЕАЛИЗАЦИЯ: socketEmit прокидывается через addon — см. ниже.
 */

export interface UseIssueChatPresenceResult {
  /** Юзеры в presence-room. */
  onlineUsers: ChatPresenceUser[];
  /** Юзеры, у которых сейчас активен typing. */
  typingUsers: ChatPresenceUser[];
  /** Уведомить сервер, что текущий пользователь печатает / перестал. */
  sendTyping: (isTyping: boolean) => void;
  /** `true`, если успешно joined в presence-room. */
  connected: boolean;
}

/**
 * Подписка на presence/typing для конкретной задачи. Если orgId/issueId не
 * заданы — хук no-op (для условного рендера без условных хуков).
 */
export function useIssueChatPresence(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): UseIssueChatPresenceResult {
  const { client, connected: wsConnected } = useTrackerWebSocket(orgId, true);
  const [onlineUsers, setOnlineUsers] = useState<ChatPresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<ChatPresenceUser[]>([]);
  const [joined, setJoined] = useState(false);

  // Таймеры авто-сброса typing per userId.
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Последний emit-timestamp для throttle.
  const lastTypingEmitRef = useRef<number>(0);
  const lastTypingValueRef = useRef<boolean>(false);

  // ── join / leave + подписки ─────────────────────────────────────────
  useEffect(() => {
    if (!client || !issueId) {
      setOnlineUsers([]);
      setTypingUsers([]);
      setJoined(false);
      return;
    }

    const socket = getSocketFromClient(client);
    if (!socket) {
      setJoined(false);
      return;
    }

    let cancelled = false;
    setJoined(false);

    // 1. JOIN с ack.
    socket.emit('issue.chat.join', { issueId }, (ack: JoinAck) => {
      if (cancelled) return;
      if (ack?.ok) {
        setOnlineUsers(ack.onlineUsers ?? []);
        setJoined(true);
      }
    });

    // 2. broadcast подписки.
    const onJoined = (payload: PresenceEventPayload): void => {
      if (payload.issueId !== issueId) return;
      setOnlineUsers((prev) => {
        if (prev.some((u) => u.userId === payload.userId)) return prev;
        return [...prev, { userId: payload.userId, displayName: payload.displayName }];
      });
    };
    const onLeft = (payload: PresenceEventPayload): void => {
      if (payload.issueId !== issueId) return;
      setOnlineUsers((prev) => prev.filter((u) => u.userId !== payload.userId));
      setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.userId));
      const t = typingTimersRef.current.get(payload.userId);
      if (t) {
        clearTimeout(t);
        typingTimersRef.current.delete(payload.userId);
      }
    };
    const onTyping = (payload: TypingEventPayload): void => {
      if (payload.issueId !== issueId) return;
      if (payload.isTyping) {
        setTypingUsers((prev) => {
          if (prev.some((u) => u.userId === payload.userId)) return prev;
          return [...prev, { userId: payload.userId, displayName: payload.displayName }];
        });
        // Авто-сброс на случай, если сервер не пришлёт isTyping=false.
        const existing = typingTimersRef.current.get(payload.userId);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setTypingUsers((prev) =>
            prev.filter((u) => u.userId !== payload.userId),
          );
          typingTimersRef.current.delete(payload.userId);
        }, TYPING_AUTO_CLEAR_MS);
        typingTimersRef.current.set(payload.userId, t);
      } else {
        setTypingUsers((prev) => prev.filter((u) => u.userId !== payload.userId));
        const t = typingTimersRef.current.get(payload.userId);
        if (t) {
          clearTimeout(t);
          typingTimersRef.current.delete(payload.userId);
        }
      }
    };

    socket.on('presence:user_joined', onJoined);
    socket.on('presence:user_left', onLeft);
    socket.on('presence:user_typing', onTyping);

    // Snapshot ref'а для cleanup — eslint react-hooks/exhaustive-deps требует
    // не использовать `ref.current` напрямую в cleanup (значение могло
    // измениться к моменту анмаунта).
    const timersSnapshot = typingTimersRef.current;
    return () => {
      cancelled = true;
      try {
        socket.emit('issue.chat.leave', { issueId });
      } catch {
        // ignore — socket мог уже умереть
      }
      socket.off('presence:user_joined', onJoined);
      socket.off('presence:user_left', onLeft);
      socket.off('presence:user_typing', onTyping);
      for (const t of timersSnapshot.values()) clearTimeout(t);
      timersSnapshot.clear();
      setOnlineUsers([]);
      setTypingUsers([]);
      setJoined(false);
    };
  }, [client, issueId]);

  // ── public sendTyping с throttle ───────────────────────────────────
  const sendTyping = useCallback(
    (isTyping: boolean): void => {
      if (!client || !issueId) return;
      const socket = getSocketFromClient(client);
      if (!socket) return;

      const now = Date.now();
      // Если значение НЕ изменилось и прошло меньше throttle — пропускаем.
      if (
        isTyping === lastTypingValueRef.current &&
        now - lastTypingEmitRef.current < TYPING_THROTTLE_MS
      ) {
        return;
      }
      lastTypingValueRef.current = isTyping;
      lastTypingEmitRef.current = now;
      try {
        socket.emit('issue.chat.typing', { issueId, isTyping });
      } catch {
        // ignore
      }
    },
    [client, issueId],
  );

  return {
    onlineUsers,
    typingUsers,
    sendTyping,
    connected: wsConnected && joined,
  };
}

/**
 * Извлечь raw socket из TrackerWsClient.
 *
 * TrackerWsClient — обёртка, скрывающая socket для большинства потребителей
 * (issues/cycles/intake), которые работают с подписками на типизированные
 * события. Presence — узкий новый случай, который требует emit с произвольным
 * именем. Чтобы не дублировать соединение, добираемся до socket'а через
 * приватное поле, добавленное `useTrackerWebSocket`.
 *
 * Если поле не найдено — возвращаем null (UI отрисует «офлайн», presence
 * деградирует gracefully).
 */
function getSocketFromClient(client: unknown): Socket | null {
  // useTrackerWebSocket кладёт socket в `__socket` поле для тестов и
  // расширений вроде presence. Если в будущем переименуют — компилятор
  // не поможет, поэтому делаем безопасный narrowing.
  if (!client || typeof client !== 'object') return null;
  const candidate = (client as { __socket?: Socket }).__socket;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof (candidate as { emit?: unknown }).emit !== 'function') return null;
  if (typeof (candidate as { on?: unknown }).on !== 'function') return null;
  return candidate;
}
