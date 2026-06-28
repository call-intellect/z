import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/error";
import { enqueue, flushOutbox } from "@/api/outbox";
import { getUserId } from "@/api/session";
import { threadsApi, type MessageAccessApi } from "@/api/threads.api";
import { chatMessageFromApi, type ChatMessage } from "@/domain/messaging";

const POLL_INTERVAL_MS = 5000;

function newClientMessageId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface State {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
}

export function useConversation(conversationId: string) {
  const [state, setState] = useState<State>({
    messages: [],
    loading: true,
    error: null,
  });
  const lastSeqRef = useRef<string | null>(null);
  const userId = getUserId();

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setState((s) => {
      const byId = new Map(s.messages.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const merged = Array.from(byId.values()).sort(
        (a, b) => Number(a.seq) - Number(b.seq),
      );
      const top = merged[merged.length - 1];
      if (top) lastSeqRef.current = top.seq;
      return { ...s, messages: merged };
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await threadsApi.listMessages(conversationId);
      const mapped = res.items.map(chatMessageFromApi);
      const top = mapped[mapped.length - 1];
      lastSeqRef.current = top ? top.seq : null;
      setState({ messages: mapped, loading: false, error: null });
      if (top) void threadsApi.markRead(conversationId, top.seq);
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : "Не удалось загрузить переписку";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, [conversationId]);

  const poll = useCallback(async () => {
    try {
      const res = await threadsApi.listMessages(
        conversationId,
        lastSeqRef.current,
      );
      if (res.items.length > 0) {
        mergeMessages(res.items.map(chatMessageFromApi));
        const top = res.items[res.items.length - 1];
        if (top) void threadsApi.markRead(conversationId, top.seq);
      }
    } catch {
      // transient errors ignored during polling
    }
  }, [conversationId, mergeMessages]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const send = useCallback(
    async (content: string, access?: MessageAccessApi) => {
      const clientMessageId = newClientMessageId();
      try {
        const res = await threadsApi.sendMessage(conversationId, {
          content,
          clientMessageId,
          ...(access ? { access } : {}),
        });
        mergeMessages([chatMessageFromApi(res.message)]);
      } catch (e) {
        if (e instanceof ApiError && e.status >= 500) throw e;
        await enqueue({
          conversationId,
          content,
          clientMessageId,
          ...(access ? { access } : {}),
          createdAt: Date.now(),
        });
        void flushOutbox();
      }
    },
    [conversationId, mergeMessages],
  );

  return { ...state, userId, send, reload: loadInitial };
}
