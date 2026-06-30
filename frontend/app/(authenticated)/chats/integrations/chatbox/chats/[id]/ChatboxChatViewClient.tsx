"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  chatboxApi,
  type ChatboxChatDetailApi,
  type ChatboxMessageApi,
} from "@/api/chatbox.api";
import {
  chatboxChannelLabel,
  chatboxChannelTypeBadgeClass,
  chatboxContentPlaceholder,
  chatboxParticipantRoleLabel,
  chatboxSenderRoleLabel,
} from "@/domain/chatbox";
import { TierGate } from "@/ui/components/TierGate";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent } from "@/ui/shadcn/card";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const PAGE = 200;

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function messageBody(m: ChatboxMessageApi): string {
  if (m.contentType === "TEXT" && m.text && m.text.trim() !== "") return m.text;
  return chatboxContentPlaceholder(m.contentType);
}

export function ChatboxChatViewClient({ chatId }: { chatId: string }) {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxChatViewContent chatId={chatId} />
    </TierGate>
  );
}

function ChatboxChatViewContent({ chatId }: { chatId: string }) {
  const [chat, setChat] = useState<ChatboxChatDetailApi | null>(null);
  const [messages, setMessages] = useState<ChatboxMessageApi[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaging, setIsPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const loadMore = useCallback(
    async (offset: number) => {
      setIsPaging(true);
      try {
        const dto = await chatboxApi.listMessages(chatId, {
          order: "asc",
          limit: PAGE,
          offset,
        });
        setTotal(dto.total);
        setMessages((prev) => [...prev, ...dto.items]);
      } catch (e) {
        setError(humanizeApiError(e, "Ошибка загрузки сообщений"));
      } finally {
        setIsPaging(false);
      }
    },
    [chatId],
  );

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setIsLoading(true);
      setError(null);
      setForbidden(false);
      try {
        const [detail, msgs] = await Promise.all([
          chatboxApi.getChat(chatId),
          chatboxApi.listMessages(chatId, { order: "asc", limit: PAGE, offset: 0 }),
        ]);
        if (cancelled) return;
        setChat(detail);
        setMessages(msgs.items);
        setTotal(msgs.total);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "forbidden") setForbidden(true);
        else setError(humanizeApiError(e, "Ошибка загрузки диалога"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  const backLink = (
    <Link
      href="/chats/integrations/chatbox/chats"
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
    >
      <ArrowLeft size={14} /> К списку диалогов
    </Link>
  );

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {backLink}
        <AdminLoading rows={6} />
      </div>
    );
  }
  if (forbidden) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {backLink}
        <AdminForbidden />
      </div>
    );
  }
  if (error || !chat) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {backLink}
        <AdminError message={error ?? "Диалог не найден"} />
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {backLink}

      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-fg-primary">
              {chat.title || chat.customer?.name || chat.clientName || chat.externalId}
            </span>
            <Badge
              variant="outline"
              className={chatboxChannelTypeBadgeClass(chat.channelType)}
            >
              {chatboxChannelLabel(chat.channelType)}
            </Badge>
            {chat.isGroup ? (
              <Badge variant="default">Группа</Badge>
            ) : (
              <Badge variant="secondary">Личный</Badge>
            )}
            <Badge variant={chat.status === "closed" ? "secondary" : "default"}>
              {chat.status === "closed" ? "Закрыт" : "Активен"}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-fg-tertiary">
            Канал: {chatboxChannelLabel(chat.channelType)}
            {chat.channelName ? ` · ${chat.channelName}` : ""}
            {chat.responsible?.name ? ` · Менеджер: ${chat.responsible.name}` : ""} ·{" "}
            {chat.messageCount} сообщений
          </div>
          {chat.isGroup && chat.participants?.length ? (
            <div className="mt-1 text-xs text-fg-tertiary">
              Участники:{" "}
              {chat.participants
                .map(
                  (p) =>
                    `${p.name || p.externalId} (${chatboxParticipantRoleLabel(p.role)}, ${p.messageCount} сообщ.)`,
                )
                .join(", ")}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-tertiary">
          В этом диалоге нет сообщений.
        </p>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => {
            const day = fmtDay(m.externalCreatedAt);
            const showDay = day !== "" && day !== lastDay;
            if (showDay) lastDay = day;
            const isClient = m.senderType === "CLIENT";
            const senderName =
              m.senderName?.trim() ||
              (m.senderType === "CLIENT"
                ? chat.customer?.name || chat.clientName || ""
                : m.senderType === "USER"
                  ? chat.responsible?.name || ""
                  : "");
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-3 text-center text-xs text-fg-tertiary">
                    {day}
                  </div>
                )}
                <div
                  className={`flex ${isClient ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 ${
                      isClient
                        ? "bg-bg-overlay text-fg-primary"
                        : "bg-accent/10 text-fg-primary"
                    }`}
                  >
                    <div className="mb-0.5 flex items-center gap-1.5 text-xs text-fg-tertiary">
                      <span className="font-medium text-fg-secondary">
                        {senderName
                          ? `${senderName} · ${chatboxSenderRoleLabel(m.senderType)}`
                          : chatboxSenderRoleLabel(m.senderType)}
                      </span>
                      {m.isOutboundFromKora && (
                        <span className="text-accent">(из Коры)</span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-sm">
                      {messageBody(m)}
                    </div>
                    <div className="mt-0.5 text-right text-[10px] text-fg-tertiary">
                      {fmtTime(m.externalCreatedAt)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {messages.length < total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPaging}
                onClick={() => void loadMore(messages.length)}
              >
                {isPaging && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                Загрузить ещё ({messages.length} из {total})
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
