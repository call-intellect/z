"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessagesSquare } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { chatboxApi, type ChatboxChatApi } from "@/api/chatbox.api";
import { useAuth } from "@/contexts/auth-context";
import { TierGate } from "@/ui/components/TierGate";
import { EmptyState } from "@/ui/components/shared/EmptyState";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent } from "@/ui/shadcn/card";
import { Input } from "@/ui/shadcn/input";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const PAGE = 30;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusLabel(status: string): string {
  if (status === "closed") return "Закрыт";
  if (status === "active") return "Активен";
  return status;
}

export function ChatboxChatsListClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxChatsListContent />
    </TierGate>
  );
}

function ChatboxChatsListContent() {
  const { currentOrgId } = useAuth();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [items, setItems] = useState<ChatboxChatApi[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaging, setIsPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      if (replace) setIsLoading(true);
      else setIsPaging(true);
      setError(null);
      setForbidden(false);
      try {
        const from = fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : undefined;
        const to = toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : undefined;
        const dto = await chatboxApi.listChats({
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          limit: PAGE,
          offset,
        });
        setTotal(dto.total);
        setItems((prev) => (replace ? dto.items : [...prev, ...dto.items]));
      } catch (e) {
        if (e instanceof ApiError && e.code === "forbidden") setForbidden(true);
        else setError(humanizeApiError(e, "Ошибка загрузки"));
      } finally {
        setIsLoading(false);
        setIsPaging(false);
      }
    },
    [fromDate, toDate],
  );

  useEffect(() => {
    void load(0, true);
  }, [load]);

  const setToday = () => {
    const d = toDateInputValue(new Date());
    setFromDate(d);
    setToDate(d);
  };
  const setYesterday = () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const d = toDateInputValue(y);
    setFromDate(d);
    setToDate(d);
  };
  const setAll = () => {
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/chats/integrations/chatbox"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft size={14} /> К интеграции
        </Link>
        <div className="flex items-center gap-2">
          <MessagesSquare size={20} className="text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Диалоги
            </h1>
            <p className="text-sm text-fg-secondary">
              Просмотр забранных переписок ChatBox по дате. Только чтение.
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-bg-card p-3">
        <label className="flex flex-col gap-1 text-xs text-fg-tertiary">
          С даты
          <Input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-tertiary">
          По дату
          <Input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="w-40"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={setToday}>
            Сегодня
          </Button>
          <Button variant="outline" size="sm" onClick={setYesterday}>
            Вчера
          </Button>
          <Button variant="outline" size="sm" onClick={setAll}>
            Все
          </Button>
        </div>
      </div>

      {isLoading && items.length === 0 && <AdminLoading rows={6} />}
      {forbidden && !isLoading && <AdminForbidden />}
      {error && !isLoading && (
        <AdminError message={error} onRetry={() => void load(0, true)} />
      )}

      {!isLoading && !forbidden && !error && items.length === 0 && (
        <EmptyState
          title="Диалогов нет"
          description="За выбранный период забранных диалогов не найдено."
        />
      )}

      {!forbidden && !error && items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-subtle">
              {items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/chats/integrations/chatbox/chats/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg-overlay"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg-primary">
                        {c.customer?.name || c.clientName || c.externalId}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-fg-tertiary">
                        {c.channelType} · {fmtDateTime(c.lastMessageAt)} ·{" "}
                        {c.messageCount} сообщ.
                      </div>
                    </div>
                    <Badge variant={c.status === "closed" ? "secondary" : "default"}>
                      {statusLabel(c.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!forbidden && !error && items.length < total && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isPaging}
            onClick={() => void load(items.length, false)}
          >
            {isPaging && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            Загрузить ещё ({items.length} из {total})
          </Button>
        </div>
      )}
    </div>
  );
}
