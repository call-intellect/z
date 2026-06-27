"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send } from "lucide-react";
import { toast } from "sonner";

import {
  conciergeApi,
  conciergeStreamApi,
  type ConciergeStreamEvent,
} from "@/api/concierge.api";
import type { ChatV2CitationApi } from "@/api/chat-v2.api";
import { tablesApi } from "@/api/tables.api";
import { clonesApi } from "@/api/clones.api";
import { meetingsApi } from "@/api/meetings.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { useConciergeConversation } from "@/hooks/useConciergeConversation";
import {
  isInferredTableSchema,
  type InferredTableSchema,
} from "@/domain/table";
import { toolNameLabel } from "@/domain/concierge";
import {
  citationDeepLink,
  cloneAnswerToChatV2Message,
  formatTimestamp,
  toChatV2Citation,
  type AssistantTarget,
  type ChatV2Citation,
} from "@/domain/chat-v2";
import { AssistantMarkdown } from "@/ui/components/chat-v2/AssistantMarkdown";
import { AssistantTargetSelect } from "@/ui/components/chat-v2/AssistantTargetSelect";
import { TableSchemaPreview } from "@/ui/concierge/TableSchemaPreview";
import { masterRowsFromEvent, type MasterRow } from "./master-chat-events";

const SOURCE_UNAVAILABLE_CODES = new Set([
  "meeting_not_found",
  "not_found",
  "db_not_found",
  "forbidden",
  "not_authorized",
]);

function isSourceUnavailableCode(code: string): boolean {
  return SOURCE_UNAVAILABLE_CODES.has(code);
}

export interface MasterConversationProps {
  conversationId?: string;
  initialInput?: string;
  onConversationChanged: () => void;
  onConversationStarted: (id: string) => void;
}

export function MasterConversation({
  conversationId,
  initialInput,
  onConversationChanged,
  onConversationStarted,
}: MasterConversationProps): ReactElement {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const detail = useConciergeConversation(conversationId ?? null);

  const [localRows, setLocalRows] = useState<MasterRow[]>([]);
  const [input, setInput] = useState(initialInput ?? "");
  const [busy, setBusy] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<AssistantTarget>({
    kind: "assistant",
  });
  const [validAt, setValidAt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [currentConv, setCurrentConv] = useState<string | undefined>(
    conversationId,
  );

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const idCounter = useRef(0);

  const nextId = useCallback(() => {
    idCounter.current += 1;
    return `r-${idCounter.current}`;
  }, []);

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const historyRows = useMemo<MasterRow[]>(() => {
    const messages = detail.data?.messages ?? [];
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: `h-${m.id}`,
        role: m.role === "user" ? "user" : "assistant",
        text: m.content,
      }));
  }, [detail.data]);

  const rows = useMemo<MasterRow[]>(
    () => [...historyRows, ...localRows],
    [historyRows, localRows],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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

  const applyEvent = useCallback(
    (ev: ConciergeStreamEvent) => {
      setLocalRows((prev) => {
        const res = masterRowsFromEvent(
          prev,
          ev,
          nextId,
          isInferredTableSchema,
          toolNameLabel,
        );
        if (res.startedConversationId && !currentConv) {
          setCurrentConv(res.startedConversationId);
          onConversationStarted(res.startedConversationId);
          onConversationChanged();
        }
        if (res.undo) {
          const { toolName, undoLogId } = res.undo;
          toast.success(`Готово: ${toolNameLabel(toolName)}`, {
            action: {
              label: "Отменить",
              onClick: () => void handleUndo(undoLogId),
            },
          });
        }
        if (res.quota) {
          toast.error(
            res.quota === "daily"
              ? "Дневная квота Мастера исчерпана"
              : "Месячная квота Мастера исчерпана",
          );
        }
        if (res.error) toast.error(res.error);
        return res.rows;
      });
    },
    [
      currentConv,
      handleUndo,
      nextId,
      onConversationChanged,
      onConversationStarted,
    ],
  );

  const sendAssistant = useCallback(
    async (trimmed: string) => {
      const asOf = validAt ? new Date(validAt).toISOString() : undefined;
      const controller = new AbortController();
      abortRef.current = controller;

      let sseFailed = false;
      try {
        for await (const ev of conciergeStreamApi(
          {
            userMessage: trimmed,
            ...(currentConv ? { conversationId: currentConv } : {}),
            ...(asOf ? { asOf } : {}),
          },
          controller.signal,
        )) {
          applyEvent(ev);
        }
      } catch (err) {
        sseFailed = true;
        console.warn("Master concierge SSE failed, fallback to polling:", err);
      } finally {
        abortRef.current = null;
      }

      if (sseFailed) {
        try {
          const r = await conciergeApi.askOnce({
            userMessage: trimmed,
            ...(currentConv ? { conversationId: currentConv } : {}),
            ...(asOf ? { asOf } : {}),
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
              onConversationStarted(r.conversationId);
              onConversationChanged();
            }
            for (const tc of r.toolCalls) {
              setLocalRows((prev) => [
                ...prev,
                {
                  id: nextId(),
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
                const undoLogId = tc.undoLogId;
                toast.success(`Готово: ${toolNameLabel(tc.toolName)}`, {
                  action: {
                    label: "Отменить",
                    onClick: () => void handleUndo(undoLogId),
                  },
                });
              }
            }
            if (r.text) {
              setLocalRows((prev) => [
                ...prev,
                {
                  id: nextId(),
                  role: "assistant",
                  text: r.text,
                  ...(r.citations ? { citations: r.citations } : {}),
                },
              ]);
            }
          }
        } catch {
          toast.error("Мастер временно недоступен");
        }
      }

      onConversationChanged();
    },
    [
      applyEvent,
      currentConv,
      handleUndo,
      nextId,
      onConversationChanged,
      onConversationStarted,
      validAt,
    ],
  );

  const sendClone = useCallback(
    async (
      trimmed: string,
      target: Extract<AssistantTarget, { kind: "clone" }>,
    ) => {
      if (!currentOrgId) {
        toast.error("Компания не выбрана. Обновите страницу и попробуйте снова.");
        return;
      }
      try {
        const res = await clonesApi.askRole(currentOrgId, target.roleId, {
          question: trimmed,
        });
        const base = cloneAnswerToChatV2Message(res);
        setLocalRows((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            text: base.text,
            ...(base.citations.length
              ? { citations: base.citations.map(chatV2ToCitationApi) }
              : {}),
          },
        ]);
      } catch (err) {
        if (err instanceof ApiError && err.code === "forbidden") {
          toast.error(`Нет доступа к клону «${target.roleName}».`);
        } else {
          toast.error(humanizeApiError(err, "Не удалось получить ответ клона."));
        }
      }
    },
    [currentOrgId, nextId],
  );

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);
    setLocalRows((prev) => [
      ...prev,
      { id: nextId(), role: "user", text: trimmed },
    ]);
    try {
      if (selectedTarget.kind === "clone") {
        await sendClone(trimmed, selectedTarget);
      } else {
        await sendAssistant(trimmed);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, input, nextId, selectedTarget, sendAssistant, sendClone]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-6 py-4 text-sm"
      >
        {rows.length === 0 && !detail.isLoading ? (
          <div className="flex h-full items-center justify-center text-fg-tertiary">
            <div className="max-w-md text-center">
              <p className="text-base font-semibold text-fg-primary">
                Я Мастер Кора
              </p>
              <p className="mt-2 text-sm">
                Спросите о памяти компании или попросите выполнить действие —
                каждый ответ подкреплён цитатами из источников.
              </p>
            </div>
          </div>
        ) : null}
        {rows.map((row) =>
          row.kind === "table_schema_preview" && row.schema ? (
            <TableSchemaPreview
              key={row.id}
              schema={row.schema}
              onConfirm={handleCreateFromSchema}
              busy={creatingTable}
            />
          ) : row.role === "user" ? (
            <div key={row.id} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-accent px-4 py-2.5 text-sm text-accent-fg">
                {row.text}
              </div>
            </div>
          ) : row.role === "assistant" ? (
            <div key={row.id} className="flex justify-start">
              <div className="max-w-[80%] rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-fg-primary">
                <div className="mb-1 text-xs text-fg-tertiary">
                  ✨ Мастер Кора
                </div>
                <AssistantMarkdown text={row.text} />
                {row.citations && row.citations.length > 0 ? (
                  <MasterCitations citations={row.citations} />
                ) : null}
              </div>
            </div>
          ) : (
            <div
              key={row.id}
              className="rounded-md bg-bg-subtle px-3 py-1.5 text-xs text-fg-tertiary"
            >
              {row.text}
            </div>
          ),
        )}
        {busy ? (
          <div className="text-xs italic text-fg-tertiary">
            Мастер печатает…
          </div>
        ) : null}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {currentOrgId ? (
          <AssistantTargetSelect
            orgId={currentOrgId}
            value={selectedTarget}
            onChange={setSelectedTarget}
            disabled={busy}
          />
        ) : null}
        <div className="flex items-center justify-between text-xs text-fg-tertiary">
          {selectedTarget.kind === "assistant" ? (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="underline-offset-2 hover:underline"
            >
              {showAdvanced ? "Скрыть" : "Дополнительно"}
            </button>
          ) : (
            <span />
          )}
          {showAdvanced && selectedTarget.kind === "assistant" ? (
            <label className="flex items-center gap-2">
              <span>На момент:</span>
              <input
                type="datetime-local"
                value={validAt}
                onChange={(e) => setValidAt(e.target.value)}
                className="rounded border border-border bg-bg px-2 py-0.5 text-xs"
                aria-label="На какой момент времени смотрит ответ"
              />
              {validAt ? (
                <button
                  type="button"
                  onClick={() => setValidAt("")}
                  className="underline"
                >
                  сбросить
                </button>
              ) : null}
            </label>
          ) : null}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            className="max-h-32 flex-1 resize-none overflow-y-auto rounded border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={
              selectedTarget.kind === "clone"
                ? `Спросите клона «${selectedTarget.roleName}»…`
                : "Что нужно сделать?"
            }
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
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}

function chatV2ToCitationApi(c: ChatV2Citation): ChatV2CitationApi {
  return {
    meetingId: c.meetingId,
    meetingTitle: c.meetingTitle,
    startMs: c.startMs,
    endMs: c.endMs,
    snippet: c.snippet,
    ...(c.documentId ? { documentId: c.documentId } : {}),
    ...(c.documentName ? { documentName: c.documentName } : {}),
  };
}

function MasterCitations({
  citations,
}: {
  citations: ChatV2CitationApi[];
}): ReactElement {
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-2">
      <div className="text-xs font-medium text-fg-tertiary">Источники:</div>
      {citations.map((c, idx) => (
        <div
          key={`${c.documentId ?? c.meetingId}-${c.startMs}-${idx}`}
          className="rounded bg-bg px-2 py-1.5 text-xs"
        >
          <MasterCitationSource citation={toChatV2Citation(c)} />
          {c.snippet ? (
            <div className="mt-0.5 italic text-fg-secondary">
              &laquo;{c.snippet}&raquo;
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MasterCitationSource({
  citation,
}: {
  citation: ChatV2Citation;
}): ReactElement {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(false);

  if (citation.documentId) {
    return (
      <div className="font-medium">
        <Link
          href={`/documents/${encodeURIComponent(citation.documentId)}`}
          className="text-accent hover:underline"
        >
          Документ: {citation.documentName ?? "без названия"}
        </Link>
      </div>
    );
  }

  const href = citationDeepLink(citation);

  if (!href || unavailable) {
    return (
      <div className="font-medium text-fg-tertiary">
        {citation.meetingTitle}{" "}
        <span className="not-italic">(источник недоступен)</span>
      </div>
    );
  }

  async function openMeeting(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    try {
      await meetingsApi.access(citation.meetingId);
      router.push(href as string);
    } catch (err) {
      if (err instanceof ApiError && !isSourceUnavailableCode(err.code)) {
        router.push(href as string);
      } else {
        setUnavailable(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="font-medium">
      <a
        href={href}
        onClick={(e) => void openMeeting(e)}
        aria-busy={checking}
        className="text-accent hover:underline aria-busy:opacity-60"
      >
        {citation.meetingTitle}{" "}
        <span className="text-fg-tertiary">
          [{formatTimestamp(citation.startMs)}]
        </span>
      </a>
    </div>
  );
}
