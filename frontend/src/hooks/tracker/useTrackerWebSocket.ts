"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import type { TrackerWsEventType } from "@/domain/tracker";

const KNOWN_EVENT_TYPES: TrackerWsEventType[] = [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "cycle.created",
  "cycle.updated",
  "cycle.progress_updated",
  "cycle.completed",
  "intake.new_item",
  "intake.triaged",
  "activity_feed.new_item",
  "import.progress",
  "import.completed",
  "import.failed",
  "sprint_hint.created",
  "sprint_hint.updated",
  "sprint_hint.dismissed",
  "sprint_hint.resolved",
];

export interface TrackerWsClient {
  on: (
    eventType: TrackerWsEventType,
    handler: (payload: unknown) => void,
  ) => () => void;
  subscribeProject: (projectId: string) => Promise<void>;
  unsubscribeProject: (projectId: string) => Promise<void>;
  subscribeIssue: (issueId: string) => Promise<void>;
  unsubscribeIssue: (issueId: string) => Promise<void>;
  close: () => void;
  __socket: Socket;
}

function resolveWsUrl(): string {
  const wsEnv =
    typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_WS_URL ?? "").trim();
  if (wsEnv && wsEnv.length > 0) {
    return wsEnv.replace(/\/+$/, "") + "/ws/tracker";
  }
  const apiEnv =
    typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
  if (apiEnv && apiEnv.length > 0) {
    return apiEnv.replace(/\/+$/, "") + "/ws/tracker";
  }
  if (typeof window !== "undefined") {
    return window.location.origin + "/ws/tracker";
  }
  return "/ws/tracker";
}

export function useTrackerWebSocket(
  orgId: string | null | undefined,
  enabled: boolean = true,
): { client: TrackerWsClient | null; connected: boolean } {
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<TrackerWsClient | null>(null);
  const [, setClientVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !orgId || typeof window === "undefined") {
      clientRef.current = null;
      setConnected(false);
      return;
    }

    const url = resolveWsUrl();

    const socket: Socket = io(url, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: { tenantId: orgId },
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    const subscribers = new Map<
      TrackerWsEventType,
      Set<(payload: unknown) => void>
    >();

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

    socket.on("connect", () => {
      setConnected(true);
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("connect_error", (err: Error) => {
      console.warn("[tracker-ws] connect_error:", err.message);
    });

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
            "subscribe.project",
            { projectId },
          );
        } catch (err) {
          console.warn("[tracker-ws] subscribeProject failed:", err);
        }
      },
      async unsubscribeProject(projectId) {
        try {
          await emitWithAck<{ ok: boolean }>("unsubscribe.project", {
            projectId,
          });
        } catch {}
      },
      async subscribeIssue(issueId) {
        try {
          await emitWithAck<{ ok: boolean; error?: string }>(
            "subscribe.issue",
            { issueId },
          );
        } catch (err) {
          console.warn("[tracker-ws] subscribeIssue failed:", err);
        }
      },
      async unsubscribeIssue(issueId) {
        try {
          await emitWithAck<{ ok: boolean }>("unsubscribe.issue", { issueId });
        } catch {}
      },
      close() {
        socket.disconnect();
      },
      __socket: socket,
    };

    clientRef.current = client;
    setClientVersion((v) => v + 1);

    return () => {
      subscribers.clear();
      socket.removeAllListeners();
      socket.disconnect();
      clientRef.current = null;
      setConnected(false);
    };
  }, [orgId, enabled]);

  return useMemo(
    () => ({ client: clientRef.current, connected }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connected, clientRef.current],
  );
}
