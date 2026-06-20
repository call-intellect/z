"use client";

import {
  Archive,
  Loader2,
  MessageCircle,
  Pin,
  PinOff,
  Plus,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";

import {
  chatV2Api,
  streamChatV2Message,
  type ChatV2AskBody,
  type ChatV2AskResponseApi,
} from "@/api/chat-v2.api";
import { clonesApi } from "@/api/clones.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { AssistantMarkdown } from "@/ui/components/chat-v2/AssistantMarkdown";
import { AssistantTargetSelect } from "@/ui/components/chat-v2/AssistantTargetSelect";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import {
  chatV2ConversationStatusLabel,
  chatV2ScopeLabel,
  citationDeepLink,
  cloneAnswerToChatV2Message,
  formatTimestamp,
  toChatV2Conversation,
  toChatV2ConversationWithMessages,
  type AssistantTarget,
  type ChatV2Conversation,
  type ChatV2ConversationStatus,
  type ChatV2ConversationWithMessages,
  type ChatV2Message,
} from "@/domain/chat-v2";

function chatV2StageLabel(
  stage: "understanding" | "searching" | "writing" | "slow" | null,
): string {
  switch (stage) {
    case "understanding":
      return "Понимаю вопрос…";
    case "searching":
      return "Ищу в памяти…";
    case "writing":
      return "Пишу ответ…";
    case "slow":
      return "Долго думаю — подождите…";
    default:
      return "Кора думает…";
  }
}

export function ChatV2Client(): ReactElement {
  const searchParams = useSearchParams();
  const initialConversationId = useMemo(
    () => searchParams?.get("conversationId") ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId,
  );
  const [statusFilter, setStatusFilter] =
    useState<ChatV2ConversationStatus>("active");

  const listKey = `chat-v2:conversations:${statusFilter}`;
  const list = useSWR(listKey, async () => {
    const dto = await chatV2Api.listConversations({
      status: statusFilter,
      limit: 50,
    });
    return {
      items: dto.items.map(toChatV2Conversation),
      total: dto.total,
    };
  });

  useEffect(() => {
    if (!initialConversationId) return;
    if (!list.data) return;
    const found = list.data.items.some((c) => c.id === initialConversationId);
    if (!found && statusFilter === "active") {
      setStatusFilter("archived");
    }
  }, [initialConversationId, list.data, statusFilter]);

  useEffect(() => {
    if (!selectedId && list.data && list.data.items.length > 0) {
      setSelectedId(list.data.items[0]!.id);
    }
  }, [list.data, selectedId]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  return (
    <div className="flex h-full w-full">
      {}
      <aside className="flex w-80 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Диалоги</h2>
            <button
              type="button"
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent/90"
              onClick={() => handleSelect(null)}
            >
              <Plus size={14} className="inline" /> Новый
            </button>
          </div>
          <div className="mt-2 flex gap-1">
            {(["active", "archived"] as ChatV2ConversationStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2 py-1 text-xs ${
                  statusFilter === s
                    ? "bg-accent text-accent-fg"
                    : "bg-bg text-fg-secondary hover:bg-surface-hover"
                }`}
              >
                {chatV2ConversationStatusLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="flex h-full items-center justify-center text-fg-tertiary">
              <Loader2 className="animate-spin" />
            </div>
          ) : list.error ? (
            <div className="p-3 text-sm text-danger">
              Не удалось загрузить список диалогов.
            </div>
          ) : !list.data || list.data.items.length === 0 ? (
            <div className="p-6 text-center text-sm text-fg-tertiary">
              {statusFilter === "active"
                ? "Пока нет диалогов. Задайте первый вопрос справа."
                : "В архиве пусто."}
            </div>
          ) : (
            list.data.items.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === selectedId}
                onClick={() => handleSelect(c.id)}
              />
            ))
          )}
        </div>
      </aside>

      {}
      <main className="flex flex-1 flex-col">
        <ConversationDetail
          conversationId={selectedId}
          onConversationCreated={(id) => {
            setSelectedId(id);
            void list.mutate();
            setTimeout(() => {
              void list.mutate();
            }, 2000);
          }}
          onConversationChanged={() => {
            void list.mutate();
          }}
        />
      </main>
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  onClick,
}: {
  conversation: ChatV2Conversation;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-surface-hover ${
        active ? "bg-accent/10" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="truncate font-medium text-fg-primary">
          {conversation.title ?? "Новый диалог"}
        </div>
        {conversation.pinnedAt ? (
          <Pin size={12} className="text-fg-tertiary shrink-0" />
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
        <span>{chatV2ScopeLabel(conversation.scope)}</span>
        <span>·</span>
        <span>{conversation.updatedAt.toLocaleDateString("ru-RU")}</span>
      </div>
    </button>
  );
}

function ConversationDetail({
  conversationId,
  onConversationCreated,
  onConversationChanged,
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  onConversationChanged: () => void;
}): ReactElement {
  const detail = useSWR(
    conversationId ? `chat-v2:conversation:${conversationId}` : null,
    async () => {
      if (!conversationId) return null;
      const dto = await chatV2Api.getConversation(conversationId);
      return toChatV2ConversationWithMessages(dto);
    },
  );

  const { currentOrgId } = useAuth();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<AssistantTarget>({
    kind: "assistant",
  });
  const [cloneConvId, setCloneConvId] = useState<Record<string, string>>({});
  const [accessDeniedRoleId, setAccessDeniedRoleId] = useState<string | null>(
    null,
  );
  const [localCloneMessages, setLocalCloneMessages] = useState<ChatV2Message[]>(
    [],
  );
  const [validAt, setValidAt] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastCacheHit, setLastCacheHit] = useState<boolean>(false);
  const [stage, setStage] = useState<
    "understanding" | "searching" | "writing" | "slow" | null
  >(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  useEffect(() => {
    setLocalCloneMessages([]);
    return () => {
      streamControllerRef.current?.abort();
      streamControllerRef.current = null;
    };
  }, [conversationId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    setSending(true);
    setError(null);
    setLastCacheHit(false);

    if (selectedTarget.kind === "clone") {
      await onSubmitClone(question, selectedTarget);
      return;
    }

    const asOfIso = validAt ? new Date(validAt).toISOString() : undefined;
    const body: ChatV2AskBody = {
      question,
      conversationId: conversationId ?? undefined,
      ...(asOfIso ? { asOf: asOfIso } : {}),
    };

    const applyAnswer = async (
      response: ChatV2AskResponseApi,
    ): Promise<void> => {
      setInput("");
      setLastCacheHit(response.cacheHit);
      if (!conversationId) {
        onConversationCreated(response.conversationId);
      } else {
        await detail.mutate();
        onConversationChanged();
      }
    };

    const slowTimer = setTimeout(() => setStage("slow"), 45_000);
    const controller = new AbortController();
    streamControllerRef.current = controller;
    try {
      try {
        setStage("understanding");
        for await (const ev of streamChatV2Message(body, controller.signal)) {
          if (ev.type === "stage") {
            setStage(ev.stage);
          } else if (ev.type === "done") {
            await applyAnswer(ev);
            break;
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      } catch {
        const response = await chatV2Api.ask(body);
        await applyAnswer(response);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не удалось получить ответ";
      setError(msg);
    } finally {
      clearTimeout(slowTimer);
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
      setSending(false);
      setStage(null);
    }
  }

  async function onSubmitClone(
    question: string,
    target: Extract<AssistantTarget, { kind: "clone" }>,
  ): Promise<void> {
    if (!currentOrgId) {
      setError("Компания не выбрана. Обновите страницу и попробуйте снова.");
      setSending(false);
      return;
    }
    const userMsg: ChatV2Message = {
      id: `local-user-${Date.now()}`,
      conversationId: conversationId ?? "",
      role: "user",
      mode: null,
      text: question,
      citations: [],
      retrievalMeta: null,
      llmMeta: null,
      createdAt: new Date(),
    };
    setLocalCloneMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAccessDeniedRoleId(null);
    try {
      const res = await clonesApi.askRole(currentOrgId, target.roleId, {
        question,
        ...(cloneConvId[target.roleId]
          ? { conversationId: cloneConvId[target.roleId] }
          : {}),
      });
      setCloneConvId((prev) => ({
        ...prev,
        [target.roleId]: res.conversationId,
      }));
      const base = cloneAnswerToChatV2Message(res);
      const cloneMsg: ChatV2Message = {
        ...base,
        llmMeta: { ...(base.llmMeta ?? {}), cloneName: target.roleName },
      };
      setLocalCloneMessages((prev) => [...prev, cloneMsg]);
    } catch (err) {
      setLocalCloneMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      if (err instanceof ApiError && err.code === "forbidden") {
        setAccessDeniedRoleId(target.roleId);
        setError(`Нет доступа к клону «${target.roleName}».`);
      } else {
        setError(humanizeApiError(err, "Не удалось получить ответ клона."));
      }
    } finally {
      setSending(false);
    }
  }

  async function requestCloneAccess(roleId: string): Promise<void> {
    if (!currentOrgId) return;
    try {
      const res = await clonesApi.requestAccess(currentOrgId, "role", roleId);
      setAccessDeniedRoleId(null);
      if (res.ok) {
        setError("Запрос на доступ отправлен администратору.");
      } else if (res.reason === "already_granted") {
        setError("Доступ уже выдан — обновите страницу.");
      } else {
        setError("Не удалось отправить запрос на доступ.");
      }
    } catch (err) {
      setError(humanizeApiError(err, "Не удалось отправить запрос на доступ."));
    }
  }

  async function togglePin(): Promise<void> {
    if (!detail.data) return;
    const target = !detail.data.pinnedAt;
    await chatV2Api.pinConversation(detail.data.id, target);
    await detail.mutate();
    onConversationChanged();
  }

  async function archive(): Promise<void> {
    if (!detail.data) return;
    const ok = await ask({
      title: "Архивировать этот диалог?",
      confirmLabel: "Архивировать",
    });
    if (!ok) return;
    await chatV2Api.archiveConversation(detail.data.id);
    onConversationChanged();
  }

  const messages = useMemo<ChatV2Message[]>(() => {
    const server = detail.data?.messages ?? [];
    const seen = new Set(server.map((m) => m.id));
    const extras = localCloneMessages.filter((m) => !seen.has(m.id));
    return [...server, ...extras];
  }, [detail.data, localCloneMessages]);

  const targetLabel =
    selectedTarget.kind === "clone"
      ? selectedTarget.roleName
      : "Помощник компании";
  const inputPlaceholder =
    selectedTarget.kind === "clone"
      ? `Спросите клона «${selectedTarget.roleName}»…`
      : "Спросите Кору о памяти компании...";

  return (
    <>
      {}
      <header className="flex items-center justify-between border-b border-border bg-bg px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-accent" />
          <h1 className="text-lg font-semibold">
            {detail.data?.title ??
              (conversationId ? "Новый диалог" : targetLabel)}
          </h1>
        </div>
        {detail.data ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePin}
              className="rounded p-1.5 text-fg-secondary hover:bg-surface-hover"
              title={detail.data.pinnedAt ? "Открепить" : "Закрепить"}
            >
              {detail.data.pinnedAt ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
            {detail.data.status === "active" ? (
              <button
                type="button"
                onClick={archive}
                className="rounded p-1.5 text-fg-secondary hover:bg-surface-hover"
                title="В архив"
              >
                <Archive size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-bg">
        {!conversationId && messages.length === 0 ? (
          <EmptyState />
        ) : !conversationId ? (
          messages.map((m) => <MessageView key={m.id} message={m} />)
        ) : detail.isLoading ? (
          <div className="flex h-full items-center justify-center text-fg-tertiary">
            <Loader2 className="animate-spin" />
          </div>
        ) : detail.error ? (
          <div className="rounded bg-chip-danger-bg px-3 py-2 text-sm text-chip-danger-fg">
            Ошибка загрузки диалога
          </div>
        ) : (
          messages.map((m) => <MessageView key={m.id} message={m} />)
        )}
        {sending ? (
          <div className="flex items-center gap-2 text-sm italic text-fg-tertiary">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            <span>{chatV2StageLabel(stage)}</span>
          </div>
        ) : null}
        {lastCacheHit ? (
          <div className="inline-flex items-center gap-1 rounded-full bg-chip-success-bg px-2 py-0.5 text-xs text-chip-success-fg self-start">
            <span aria-hidden>•</span>
            <span>Ответ из кэша (мгновенно)</span>
          </div>
        ) : null}
        {error ? (
          <div className="rounded bg-chip-danger-bg px-3 py-2 text-sm text-chip-danger-fg">
            <span>{error}</span>
            {accessDeniedRoleId ? (
              <button
                type="button"
                onClick={() => void requestCloneAccess(accessDeniedRoleId)}
                className="ml-2 font-medium underline underline-offset-2 hover:no-underline"
              >
                Запросить доступ
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {}
      <form
        onSubmit={onSubmit}
        className="border-t border-border bg-surface p-3 pb-20 sm:pr-20 flex flex-col gap-2"
      >
        {}
        {currentOrgId ? (
          <AssistantTargetSelect
            orgId={currentOrgId}
            value={selectedTarget}
            onChange={setSelectedTarget}
            disabled={sending}
          />
        ) : null}
        {}
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
                aria-label="Temporal query — на какой момент времени смотрит ответ"
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
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={inputPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
      {confirmDialog}
    </>
  );
}

function EmptyState(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-fg-tertiary">
      <div className="max-w-md text-center">
        <MessageCircle size={32} className="mx-auto mb-3 text-accent" />
        <h2 className="text-lg font-semibold text-fg-primary">
          Начните новый диалог
        </h2>
        <p className="mt-2 text-sm">
          Задайте любой вопрос — Кора ответит на основе встреч, документов и
          решений вашей компании. Каждый ответ подкреплён цитатами из
          источников.
        </p>
      </div>
    </div>
  );
}

function MessageView({ message }: { message: ChatV2Message }): ReactElement {
  const isUser = message.role === "user";
  const isClone = message.mode === "clone_style";
  const cloneName =
    typeof message.llmMeta?.["cloneName"] === "string"
      ? (message.llmMeta["cloneName"] as string)
      : "Клон должности";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? "whitespace-pre-wrap bg-accent text-accent-fg"
            : "bg-surface border border-border text-fg-primary"
        }`}
      >
        {!isUser ? (
          <div className="mb-1 text-xs text-fg-tertiary">
            {isClone ? `🧩 ${cloneName}` : "✨ Мастер Кора"}
          </div>
        ) : null}
        {isUser ? (
          <div>{message.text}</div>
        ) : (
          <AssistantMarkdown text={message.text} />
        )}

        {!isUser && message.citations.length > 0 ? (
          <div className="mt-3 space-y-1.5 border-t border-border pt-2">
            <div className="text-xs font-medium text-fg-tertiary">
              Источники:
            </div>
            {message.citations.map((c, idx) => (
              <div
                key={`${c.documentId ?? c.meetingId}-${c.startMs}-${idx}`}
                className="rounded bg-bg px-2 py-1.5 text-xs"
              >
                {c.documentId ? (
                  <div className="font-medium">
                    <Link
                      href={`/documents/${encodeURIComponent(c.documentId)}`}
                      className="text-accent hover:underline"
                    >
                      Документ: {c.documentName ?? "без названия"}
                    </Link>
                  </div>
                ) : citationDeepLink(c) ? (
                  <div className="font-medium">
                    <Link
                      href={citationDeepLink(c) as string}
                      className="text-accent hover:underline"
                    >
                      {c.meetingTitle}{" "}
                      <span className="text-fg-tertiary">
                        [{formatTimestamp(c.startMs)}]
                      </span>
                    </Link>
                  </div>
                ) : (
                  <div className="font-medium">
                    {c.meetingTitle}{" "}
                    <span className="text-fg-tertiary">
                      [{formatTimestamp(c.startMs)}]
                    </span>
                  </div>
                )}
                <div className="mt-0.5 italic text-fg-secondary">
                  &laquo;{c.snippet}&raquo;
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!isUser ? <MessageFeedback messageId={message.id} /> : null}
      </div>
    </div>
  );
}

function MessageFeedback({ messageId }: { messageId: string }): ReactElement {
  const [helpful, setHelpful] = useState<"up" | "down" | null>(null);

  function vote(next: "up" | "down"): void {
    const prev = helpful;
    if (prev === next) {
      setHelpful(null);
      void chatV2Api.clearFeedback(messageId).catch(() => setHelpful(prev));
      return;
    }
    setHelpful(next);
    void chatV2Api.setFeedback(messageId, next).catch(() => setHelpful(prev));
  }

  return (
    <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => vote("up")}
        title="Ответ помог"
        aria-label="Ответ помог"
        aria-pressed={helpful === "up"}
        className={`rounded p-1 transition-colors hover:bg-surface-hover ${
          helpful === "up" ? "text-accent" : "text-fg-tertiary"
        }`}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => vote("down")}
        title="Ответ не помог"
        aria-label="Ответ не помог"
        aria-pressed={helpful === "down"}
        className={`rounded p-1 transition-colors hover:bg-surface-hover ${
          helpful === "down" ? "text-danger" : "text-fg-tertiary"
        }`}
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}
