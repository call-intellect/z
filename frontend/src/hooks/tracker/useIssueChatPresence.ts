"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { useTrackerWebSocket } from "./useTrackerWebSocket";

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

const TYPING_AUTO_CLEAR_MS = 4_000;

const TYPING_THROTTLE_MS = 300;

export interface UseIssueChatPresenceResult {
  onlineUsers: ChatPresenceUser[];
  typingUsers: ChatPresenceUser[];
  sendTyping: (isTyping: boolean) => void;
  connected: boolean;
}

export function useIssueChatPresence(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): UseIssueChatPresenceResult {
  const { client, connected: wsConnected } = useTrackerWebSocket(orgId, true);
  const [onlineUsers, setOnlineUsers] = useState<ChatPresenceUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<ChatPresenceUser[]>([]);
  const [joined, setJoined] = useState(false);

  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const lastTypingEmitRef = useRef<number>(0);
  const lastTypingValueRef = useRef<boolean>(false);

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

    socket.emit("issue.chat.join", { issueId }, (ack: JoinAck) => {
      if (cancelled) return;
      if (ack?.ok) {
        setOnlineUsers(ack.onlineUsers ?? []);
        setJoined(true);
      }
    });

    const onJoined = (payload: PresenceEventPayload): void => {
      if (payload.issueId !== issueId) return;
      setOnlineUsers((prev) => {
        if (prev.some((u) => u.userId === payload.userId)) return prev;
        return [
          ...prev,
          { userId: payload.userId, displayName: payload.displayName },
        ];
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
          return [
            ...prev,
            { userId: payload.userId, displayName: payload.displayName },
          ];
        });
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
        setTypingUsers((prev) =>
          prev.filter((u) => u.userId !== payload.userId),
        );
        const t = typingTimersRef.current.get(payload.userId);
        if (t) {
          clearTimeout(t);
          typingTimersRef.current.delete(payload.userId);
        }
      }
    };

    socket.on("presence:user_joined", onJoined);
    socket.on("presence:user_left", onLeft);
    socket.on("presence:user_typing", onTyping);

    const timersSnapshot = typingTimersRef.current;
    return () => {
      cancelled = true;
      try {
        socket.emit("issue.chat.leave", { issueId });
      } catch {}
      socket.off("presence:user_joined", onJoined);
      socket.off("presence:user_left", onLeft);
      socket.off("presence:user_typing", onTyping);
      for (const t of timersSnapshot.values()) clearTimeout(t);
      timersSnapshot.clear();
      setOnlineUsers([]);
      setTypingUsers([]);
      setJoined(false);
    };
  }, [client, issueId]);

  const sendTyping = useCallback(
    (isTyping: boolean): void => {
      if (!client || !issueId) return;
      const socket = getSocketFromClient(client);
      if (!socket) return;

      const now = Date.now();
      if (
        isTyping === lastTypingValueRef.current &&
        now - lastTypingEmitRef.current < TYPING_THROTTLE_MS
      ) {
        return;
      }
      lastTypingValueRef.current = isTyping;
      lastTypingEmitRef.current = now;
      try {
        socket.emit("issue.chat.typing", { issueId, isTyping });
      } catch {}
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

function getSocketFromClient(client: unknown): Socket | null {
  if (!client || typeof client !== "object") return null;
  const candidate = (client as { __socket?: Socket }).__socket;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof (candidate as { emit?: unknown }).emit !== "function") return null;
  if (typeof (candidate as { on?: unknown }).on !== "function") return null;
  return candidate;
}
