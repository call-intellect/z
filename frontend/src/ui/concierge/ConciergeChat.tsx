"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import {
  conciergeApi,
  conciergeStreamApi,
  type ConciergePageContextApi,
  type ConciergeStreamEvent,
} from "@/api/concierge.api";
import { tablesApi } from "@/api/tables.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import {
  isInferredTableSchema,
  type InferredTableSchema,
} from "@/domain/table";
import { toolNameLabel } from "@/domain/concierge";
import { TableSchemaPreview } from "./TableSchemaPreview";
import { toast } from "sonner";

export interface ConciergeChatProps {
  pageContext?: ConciergePageContextApi;
  conversationId?: string;
  className?: string;
  onConversationStarted?: (id: string) => void;
  initialInput?: string;
}

interface ChatRow {
  id: string;
  kind?: "table_schema_preview";
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  meta?: { toolName?: string; ok?: boolean; undoLogId?: string };
  schema?: InferredTableSchema;
}

export function ConciergeChat({
  pageContext,
  conversationId,
  className,
  onConversationStarted,
  initialInput,
}: ConciergeChatProps) {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [rows, setRows] = useState<ChatRow[]>([]);
  const [input, setInput] = useState(initialInput ?? "");
  const [busy, setBusy] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  const [currentConv, setCurrentConv] = useState<string | undefined>(
    conversationId,
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const handleCreateFromSchema = useCallback(
    async (schema: InferredTableSchema) => {
      if (!currentOrgId) {
        toast.error("Не выбрана организация");
        return;
      }
      setCreatingTable(true);
      try {
        const created = await tablesApi.createFromSchema(currentOrgId, schema);
        toast.success("Таблица создана", {
          action: {
            label: "Открыть",
            onClick: () => router.push(`/tables/${created.id}`),
          },
        });
        router.push(`/tables/${created.id}`);
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.code === "feature_tables_text_to_schema_disabled"
        ) {
          toast.error(
            "Создание таблиц по описанию пока отключено в этой организации",
          );
        } else {
          toast.error(humanizeApiError(e, "Не удалось создать таблицу"));
        }
      } finally {
        setCreatingTable(false);
      }
    },
    [currentOrgId, router],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  const handleUndo = useCallback(async (logId: string) => {
    try {
      const res = await conciergeApi.undo(logId);
      if (res.ok) {
        toast.success("Действие отменено");
      } else {
        toast.error(res.message ?? "Не удалось отменить");
      }
    } catch {
      toast.error("Ошибка отмены");
    }
  }, []);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);
    setRows((r) => [
      ...r,
      { id: `u-${Date.now()}`, role: "user", text: trimmed },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    let sseFailed = false;
    try {
      for await (const ev of conciergeStreamApi(
        {
          userMessage: trimmed,
          ...(currentConv ? { conversationId: currentConv } : {}),
          ...(pageContext ? { pageContext } : {}),
        },
        controller.signal,
      )) {
        applyEvent(ev);
      }
    } catch (err) {
      sseFailed = true;
      console.warn("Concierge SSE failed, fallback to polling:", err);
    } finally {
      abortRef.current = null;
    }

    if (sseFailed) {
      try {
        const r = await conciergeApi.askOnce({
          userMessage: trimmed,
          ...(currentConv ? { conversationId: currentConv } : {}),
          ...(pageContext ? { pageContext } : {}),
        });
        if (r.quotaExceeded) {
          toast.error(
            r.quotaExceeded === "daily"
              ? "Дневная квота Мастера исчерпана"
              : "Месячная квота Мастера исчерпана",
          );
        } else if (r.error) {
          toast.error(r.error.message);
        } else {
          if (!currentConv && r.conversationId) {
            setCurrentConv(r.conversationId);
            onConversationStarted?.(r.conversationId);
          }
          for (const tc of r.toolCalls) {
            setRows((prev) => [
              ...prev,
              {
                id: `t-${tc.toolName}-${Date.now()}`,
                role: "tool",
                text: `${toolNameLabel(tc.toolName)} (${tc.ok ? "ок" : "ошибка"})`,
                meta: {
                  toolName: tc.toolName,
                  ok: tc.ok,
                  ...(tc.undoLogId ? { undoLogId: tc.undoLogId } : {}),
                },
              },
            ]);
            if (tc.undoLogId) {
              toast.success(`Готово: ${toolNameLabel(tc.toolName)}`, {
                action: {
                  label: "Отменить",
                  onClick: () => handleUndo(tc.undoLogId!),
                },
              });
            }
          }
          if (r.text) {
            setRows((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: r.text,
              },
            ]);
          }
        }
      } catch {
        toast.error("Мастер временно недоступен");
      }
    }

    setBusy(false);

    function applyEvent(ev: ConciergeStreamEvent) {
      switch (ev.type) {
        case "started":
          if (!currentConv) {
            setCurrentConv(ev.conversationId);
            onConversationStarted?.(ev.conversationId);
          }
          break;
        case "tool_call":
          setRows((prev) => [
            ...prev,
            {
              id: `tc-${Date.now()}`,
              role: "system",
              text: `${toolNameLabel(ev.toolName)}${
                ev.requiresConfirm ? " (требуется подтверждение)" : ""
              }`,
            },
          ]);
          break;
        case "tool_result":
          if (
            ev.toolName === "infer_table_schema" &&
            ev.ok &&
            isInferredTableSchema(ev.data)
          ) {
            const schema = ev.data;
            setRows((prev) => [
              ...prev,
              {
                id: `ts-${Date.now()}`,
                kind: "table_schema_preview",
                role: "tool",
                text: "Предлагаю такую таблицу",
                schema,
              },
            ]);
            break;
          }
          setRows((prev) => [
            ...prev,
            {
              id: `tr-${Date.now()}`,
              role: "tool",
              text: `${toolNameLabel(ev.toolName)}: ${ev.ok ? "успех" : `ошибка ${ev.status}`}`,
              meta: {
                toolName: ev.toolName,
                ok: ev.ok,
                ...(ev.undoLogId ? { undoLogId: ev.undoLogId } : {}),
              },
            },
          ]);
          if (ev.undoLogId) {
            toast.success(`Готово: ${toolNameLabel(ev.toolName)}`, {
              action: {
                label: "Отменить",
                onClick: () => handleUndo(ev.undoLogId!),
              },
            });
          }
          break;
        case "message":
          setRows((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", text: ev.text },
          ]);
          break;
        case "quota_exceeded":
          toast.error(
            ev.scope === "daily"
              ? "Дневная квота Мастера исчерпана"
              : "Месячная квота Мастера исчерпана",
          );
          break;
        case "error":
          toast.error(ev.message);
          break;
        case "thinking":
        case "done":
        default:
          break;
      }
    }
  }, [
    input,
    busy,
    currentConv,
    pageContext,
    handleUndo,
    onConversationStarted,
  ]);

  return (
    <div
      className={
        className ??
        "flex h-full max-h-[600px] w-full flex-col rounded-md border border-border-subtle bg-bg-base"
      }
    >
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-3 text-sm"
      >
        {rows.length === 0 && (
          <div className="text-center text-fg-tertiary">
            Я Мастер. Спросите что-нибудь или попросите выполнить действие.
          </div>
        )}
        {rows.map((row) =>
          row.kind === "table_schema_preview" && row.schema ? (
            <TableSchemaPreview
              key={row.id}
              schema={row.schema}
              onConfirm={handleCreateFromSchema}
              busy={creatingTable}
            />
          ) : (
            <div
              key={row.id}
              className={
                row.role === "user"
                  ? "rounded-md bg-bg-overlay p-2"
                  : row.role === "assistant"
                    ? "rounded-md bg-chip-success-bg p-2 text-chip-success-fg"
                    : "rounded-md bg-bg-subtle p-2 text-xs text-fg-tertiary"
              }
            >
              {row.text}
            </div>
          ),
        )}
        {busy && (
          <div className="text-xs text-fg-tertiary">Мастер печатает…</div>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-border-subtle p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          className="max-h-32 flex-1 resize-none overflow-y-auto rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm"
          placeholder="Что нужно сделать?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-50"
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
