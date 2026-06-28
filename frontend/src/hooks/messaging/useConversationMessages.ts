"use client";

import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { messagingApi, type SendMessageBody } from "@/api/messaging.api";
import {
  chatMessageFromApi,
  maxSeq,
  seqGreater,
  type ChatMessage,
  type MessageApi,
} from "@/domain/messaging";
import { useTrackerWebSocket } from "@/hooks/tracker/useTrackerWebSocket";

import { useConversationPresence } from "./useConversationPresence";

export interface SendOptions {
  parentMessageId?: string;
  access?: SendMessageBody["access"];
  mentions?: string[];
}

export interface UseConversationMessagesResult {
  messages: ChatMessage[];
  isLoading: boolean;
  error: unknown;
  send: (content: string, opts?: SendOptions) => Promise<void>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  markReadToLatest: () => Promise<void>;
  onlineUsers: { userId: string; displayName: string }[];
  typingUsers: { userId: string; displayName: string }[];
  sendTyping: (isTyping: boolean) => void;
  connected: boolean;
}

function mergeMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === incoming.id);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = incoming;
    return next;
  }
  const next = [...prev, incoming];
  next.sort((a, b) => (seqGreater(a.seq, b.seq) ? 1 : -1));
  return next;
}

export function useConversationMessages(
  orgId: string | null | undefined,
  conversationId: string | null | undefined,
): UseConversationMessagesResult {
  const { client } = useTrackerWebSocket(orgId, true);
  const presence = useConversationPresence(orgId, conversationId);

  const key =
    orgId && conversationId
      ? (["messaging.messages", orgId, conversationId] as const)
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !conversationId) throw new Error("orgId/conversationId required");
      const res = await messagingApi.listMessages(orgId, conversationId);
      return res.items.map(chatMessageFromApi);
    },
    { revalidateOnFocus: false },
  );

  const [live, setLive] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setLive([]);
  }, [conversationId]);

  const messages = useMemo<ChatMessage[]>(() => {
    const base = swr.data ?? [];
    let merged = base;
    for (const m of live) merged = mergeMessage(merged, m);
    return merged;
  }, [swr.data, live]);

  const latestSeq = useMemo(() => maxSeq(messages), [messages]);
  const latestSeqRef = useRef<string | null>(null);
  latestSeqRef.current = latestSeq;

  useEffect(() => {
    if (!client || !conversationId) return;
    const off = client.on("message.new", (payload) => {
      const dto = payload as MessageApi;
      if (!dto || dto.conversationId !== conversationId) return;
      setLive((prev) => mergeMessage(prev, chatMessageFromApi(dto)));
    });
    return off;
  }, [client, conversationId]);

  useEffect(() => {
    if (!orgId || !conversationId || !presence.connected) return;
    const sinceSeq = latestSeqRef.current;
    if (!sinceSeq) return;
    let cancelled = false;
    void messagingApi
      .listMessages(orgId, conversationId, sinceSeq)
      .then((res) => {
        if (cancelled) return;
        const fresh = res.items.map(chatMessageFromApi);
        if (fresh.length === 0) return;
        setLive((prev) => {
          let merged = prev;
          for (const m of fresh) merged = mergeMessage(merged, m);
          return merged;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId, conversationId, presence.connected]);

  const send = useCallback(
    async (content: string, opts?: SendOptions): Promise<void> => {
      if (!orgId || !conversationId) return;
      const trimmed = content.trim();
      if (!trimmed) return;
      const res = await messagingApi.sendMessage(orgId, conversationId, {
        content: trimmed,
        clientMessageId: nanoid(16),
        ...(opts?.parentMessageId
          ? { parentMessageId: opts.parentMessageId }
          : {}),
        ...(opts?.access ? { access: opts.access } : {}),
        ...(opts?.mentions ? { mentions: opts.mentions } : {}),
      });
      setLive((prev) => mergeMessage(prev, chatMessageFromApi(res.message)));
    },
    [orgId, conversationId],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      if (!orgId || !conversationId) return;
      const res = await messagingApi.toggleReaction(
        orgId,
        conversationId,
        messageId,
        emoji,
      );
      const apply = (m: ChatMessage): ChatMessage =>
        m.id === messageId ? { ...m, reactions: res.reactions } : m;
      setLive((prev) => prev.map(apply));
      await swr.mutate(
        (cur) => (cur ? cur.map(apply) : cur),
        { revalidate: false },
      );
    },
    [orgId, conversationId, swr],
  );

  const markReadToLatest = useCallback(async (): Promise<void> => {
    if (!orgId || !conversationId) return;
    const seq = latestSeqRef.current;
    if (!seq) return;
    try {
      await messagingApi.markRead(orgId, conversationId, seq);
    } catch {}
  }, [orgId, conversationId]);

  return {
    messages,
    isLoading: swr.isLoading,
    error: swr.error,
    send,
    toggleReaction,
    markReadToLatest,
    onlineUsers: presence.onlineUsers,
    typingUsers: presence.typingUsers,
    sendTyping: presence.sendTyping,
    connected: presence.connected,
  };
}
