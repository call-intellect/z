"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { adminFeedbackApi } from "@/api/admin-feedback.api";
import {
  formatAuthor,
  toFeedbackItemMessage,
  type FeedbackItem,
} from "@/domain/admin-feedback";
import { Button } from "@/ui/shadcn/button";

interface ItemRowProps {
  topicId: string;
  item: FeedbackItem;
}

export function ItemRow({ topicId, item }: ItemRowProps) {
  const [expanded, setExpanded] = useState(false);

  const swr = useSWR(
    expanded ? ["admin-feedback-item-message", topicId, item.id] : null,
    expanded
      ? async () => adminFeedbackApi.getItemMessage(topicId, item.id)
      : null,
    { revalidateOnFocus: false },
  );

  const message = swr.data ? toFeedbackItemMessage(swr.data) : null;
  const errorMessage =
    swr.error instanceof ApiError
      ? swr.error.message
      : swr.error
        ? "Не удалось загрузить сообщение"
        : null;

  return (
    <>
      <tr className="border-t border-border-subtle align-top">
        <td className="px-3 py-2 text-xs text-fg-secondary">
          {item.createdAt.toLocaleDateString("ru-RU")}
          <div className="text-fg-tertiary">
            {item.createdAt.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="font-medium text-fg-primary">
            {item.user.name ?? item.user.email}
          </div>
          {item.user.name && (
            <div className="text-fg-tertiary">{item.user.email}</div>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-fg-secondary">
          {item.org ? (
            item.org.name
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-fg-primary">
          {item.text}
          {item.discarded && (
            <div className="mt-1 text-xs text-fg-tertiary">
              Отбракован
              {item.discardReason ? ` — ${item.discardReason}` : ""}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            className="h-7 px-2"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border-subtle bg-bg-subtle">
          <td colSpan={5} className="px-3 py-3">
            <div className="text-xs uppercase text-fg-tertiary">
              Исходное сообщение
            </div>
            {swr.isLoading && (
              <div className="mt-1 text-xs text-fg-tertiary">Загружаем…</div>
            )}
            {errorMessage && (
              <div className="mt-1 text-xs text-danger">{errorMessage}</div>
            )}
            {message && (
              <>
                <div className="mt-1 whitespace-pre-wrap text-sm text-fg-primary">
                  {message.text}
                </div>
                <div className="mt-2 text-xs text-fg-tertiary">
                  Автор: {formatAuthor(message.user)} ·{" "}
                  {message.createdAt.toLocaleString("ru-RU")}
                  {message.org && ` · ${message.org.name}`}
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
