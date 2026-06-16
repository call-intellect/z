"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { chatApi } from "@/api/chat.api";
import { ApiError } from "@/api/api-error";
import {
  chatCitationFromApi,
  chatMessageFromApi,
  type ChatMessageDomain,
} from "@/domain/chat-message";
import { toast } from "@/ui/shadcn/toast";

export function useMeetingChat(meetingId: string | null | undefined) {
  const [messages, setMessages] = useState<ChatMessageDomain[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    const inflightSnapshot = inflight;
    setHistoryLoading(true);
    chatApi
      .historyMeeting(meetingId)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.items.map(chatMessageFromApi));
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      inflightSnapshot.current?.abort();
    };
  }, [meetingId]);

  const send = useCallback(
    async (text: string) => {
      if (!meetingId || !text.trim() || thinking) return;
      const userMsg: ChatMessageDomain = {
        id: `local-${nanoid(8)}`,
        role: "user",
        content: text.trim(),
        citations: [],
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setThinking(true);
      try {
        const res = await chatApi.sendMeeting(meetingId, {
          message: text.trim(),
        });
        const assistantMsg: ChatMessageDomain = {
          id: `assist-${nanoid(8)}`,
          role: "assistant",
          content: res.message,
          citations: (res.citations ?? []).map(chatCitationFromApi),
          createdAt: new Date(),
        };
        void chatMessageFromApi;
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        const message =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Не удалось отправить сообщение.";
        toast.error(message);
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, failed: true } : m)),
        );
      } finally {
        setThinking(false);
      }
    },
    [meetingId, thinking],
  );

  const retry = useCallback(
    async (failedId: string) => {
      const failed = messages.find((m) => m.id === failedId);
      if (!failed) return;
      setMessages((prev) => prev.filter((m) => m.id !== failedId));
      await send(failed.content);
    },
    [messages, send],
  );

  return {
    messages,
    historyLoading,
    thinking,
    send,
    retry,
  };
}
