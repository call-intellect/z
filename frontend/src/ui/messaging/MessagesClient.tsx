"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Info,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  type InboxSort,
  type InboxThreadType,
  messagingApi,
} from "@/api/messaging.api";
import { useAuth } from "@/contexts/auth-context";
import type { ChatMessage, InboxThread } from "@/domain/messaging";
import { useConversationMessages } from "@/hooks/messaging/useConversationMessages";
import { useMessageThreads } from "@/hooks/messaging/useMessageThreads";
import { useUnreadMessageCount } from "@/hooks/messaging/useUnreadMessageCount";
import { useIsMobile } from "@/hooks/useIsMobile";
import { AssigneeAvatar } from "@/ui/tracker/AssigneeAvatar";
import { Button } from "@/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { Input } from "@/ui/shadcn/input";
import { Textarea } from "@/ui/shadcn/textarea";
import { cn } from "@/ui/shadcn/lib/utils";

import { MessageBubble } from "./MessageBubble";
import { NewConversationDialog } from "./NewConversationDialog";

interface TabConfig {
  key: string;
  label: string;
  type: InboxThreadType;
}

const TABS: TabConfig[] = [
  { key: "all", label: "Всё", type: "all" },
  { key: "dm", label: "Личные", type: "dm" },
  { key: "group", label: "Группы", type: "group" },
  { key: "channel", label: "Работа", type: "channel" },
  { key: "work_chat", label: "Задачи", type: "work_chat" },
  { key: "external", label: "Клиенты", type: "external" },
  { key: "ticket", label: "Поддержка", type: "ticket" },
  { key: "unread", label: "Непрочитанное", type: "unread" },
];

const SORTS: { key: InboxSort; label: string }[] = [
  { key: "recent", label: "По свежести" },
  { key: "active", label: "По активности" },
  { key: "unread", label: "Сначала непрочитанные" },
];

function formatRelative(d: Date | null): string {
  if (!d) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day && d.getDate() === new Date().getDate()) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * day) {
    return d.toLocaleDateString("ru-RU", { weekday: "short" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function MessagesClient() {
  const { currentOrgId, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<TabConfig>(TABS[0]!);
  const [sort, setSort] = useState<InboxSort>("recent");
  const [feedQuery, setFeedQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(
    searchParams.get("conversation"),
  );
  const [mobilePane, setMobilePane] = useState<"list" | "chat">(
    searchParams.get("conversation") ? "chat" : "list",
  );
  const [showContext, setShowContext] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { total: unreadCount } = useUnreadMessageCount(currentOrgId);

  const { threads, isLoading, error, hasMore, isLoadingMore, loadMore, mutate } =
    useMessageThreads(currentOrgId, {
      type: tab.type,
      sort,
      q: feedQuery,
    });

  const activeThread = useMemo<InboxThread | null>(
    () => threads.find((t) => t.refId === activeId) ?? null,
    [threads, activeId],
  );

  useEffect(() => {
    const fromUrl = searchParams.get("conversation");
    if (fromUrl && fromUrl !== activeId) {
      setActiveId(fromUrl);
      setMobilePane("chat");
    }
  }, [searchParams, activeId]);

  const openThread = useCallback(
    (refId: string) => {
      setActiveId(refId);
      setMobilePane("chat");
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("conversation", refId);
      router.replace(`/messages?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const backToList = useCallback(() => {
    setMobilePane("list");
  }, []);

  const handleConversationCreated = useCallback(
    async (conversationId: string) => {
      setTab(TABS[0]!);
      setFeedQuery("");
      openThread(conversationId);
      await mutate();
    },
    [mutate, openThread],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col md:h-[calc(100vh-var(--header-h))]">
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_312px]">
        <ThreadList
          className={cn(
            "min-h-0 border-border md:border-r",
            isMobile && mobilePane === "chat" ? "hidden" : "flex",
          )}
          tab={tab}
          onTab={setTab}
          sort={sort}
          onSort={setSort}
          feedQuery={feedQuery}
          onFeedQuery={setFeedQuery}
          threads={threads}
          isLoading={isLoading}
          error={error}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          loadMore={loadMore}
          activeId={activeId}
          onOpen={openThread}
          onNewConversation={() => setNewOpen(true)}
          unreadCount={unreadCount}
          orgId={currentOrgId}
        />

        <ChatPane
          className={cn(
            "min-h-0",
            isMobile && mobilePane === "list" ? "hidden" : "flex",
          )}
          orgId={currentOrgId}
          thread={activeThread}
          conversationId={activeId}
          currentUserId={user?.id ?? null}
          onBack={isMobile ? backToList : undefined}
          onThreadsMutate={mutate}
          onToggleContext={() => setShowContext((v) => !v)}
        />

        {activeThread ? (
          <ContextPanel
            className="hidden min-h-0 border-l border-border xl:flex"
            thread={activeThread}
          />
        ) : null}
      </div>

      <NewConversationDialog
        orgId={currentOrgId}
        currentUserId={user?.id ?? null}
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={handleConversationCreated}
        onListMutate={mutate}
      />

      {showContext && activeThread ? (
        <div className="fixed inset-0 z-40 flex xl:hidden">
          <button
            type="button"
            aria-label="Закрыть"
            className="flex-1 bg-bg-overlay"
            onClick={() => setShowContext(false)}
          />
          <ContextPanel
            className="flex w-[300px] max-w-[85vw] border-l border-border bg-bg-base"
            thread={activeThread}
            onClose={() => setShowContext(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ThreadList({
  className,
  tab,
  onTab,
  sort,
  onSort,
  feedQuery,
  onFeedQuery,
  threads,
  isLoading,
  error,
  hasMore,
  isLoadingMore,
  loadMore,
  activeId,
  onOpen,
  onNewConversation,
  unreadCount,
}: {
  className?: string;
  tab: TabConfig;
  onTab: (t: TabConfig) => void;
  sort: InboxSort;
  onSort: (s: InboxSort) => void;
  feedQuery: string;
  onFeedQuery: (v: string) => void;
  threads: InboxThread[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  activeId: string | null;
  onOpen: (refId: string) => void;
  onNewConversation: () => void;
  unreadCount: number;
  orgId: string | null;
}) {
  const activeSort = SORTS.find((s) => s.key === sort) ?? SORTS[0]!;
  return (
    <div className={cn("flex flex-col bg-bg-surface/40", className)}>
      <div className="flex flex-col gap-3 p-4 pb-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Сообщения</h1>
          {unreadCount > 0 ? (
            <span className="rounded-full bg-accent-muted px-2 py-0.5 text-xs font-semibold text-accent">
              {unreadCount}
            </span>
          ) : null}
          <Button
            size="sm"
            className="ml-auto"
            onClick={onNewConversation}
          >
            <Plus size={15} className="mr-1" />
            Новое сообщение
          </Button>
        </div>
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <Input
            value={feedQuery}
            onChange={(e) => onFeedQuery(e.target.value)}
            placeholder="Поиск по людям, группам, PROJ-NN…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              tab.key === t.key
                ? "border-accent bg-accent text-accent-fg"
                : "border-border bg-bg-surface text-fg-secondary hover:text-fg-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary"
            >
              {activeSort.label}
              <ChevronDown size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SORTS.map((s) => (
              <DropdownMenuItem key={s.key} onSelect={() => onSort(s.key)}>
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="flex flex-col gap-2 px-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated"
              />
            ))}
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-sm text-danger">
            Не удалось загрузить разговоры.
          </div>
        ) : threads.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-fg-tertiary">
            {feedQuery ? "Ничего не найдено." : "Разговоров пока нет."}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((t) => (
              <ThreadRow
                key={t.refId}
                thread={t}
                active={t.refId === activeId}
                onClick={() => onOpen(t.refId)}
              />
            ))}
            {hasMore ? (
              <li className="px-2 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    "Показать ещё"
                  )}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
}: {
  thread: InboxThread;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
          active
            ? "border-border-strong bg-bg-elevated"
            : "border-transparent hover:bg-bg-surface",
        )}
      >
        <AssigneeAvatar userId={thread.refId} label={thread.title} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {thread.kind === "work_chat" && thread.linkedIssue ? (
              <span className="shrink-0 rounded-full bg-chip-info-bg px-1.5 py-0.5 font-mono text-[10px] font-semibold text-chip-info-fg">
                {thread.linkedIssue.identifier}
              </span>
            ) : null}
            <span className="truncate text-sm font-medium text-fg-primary">
              {thread.title}
            </span>
            {thread.slaBreached ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
                aria-label="SLA нарушен"
              />
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-fg-tertiary">
            {thread.snippet || "Нет сообщений"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] text-fg-tertiary">
            {formatRelative(thread.lastMessageAt)}
          </span>
          {thread.hasUnread ? (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
              {thread.unreadCount}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function ChatPane({
  className,
  orgId,
  thread,
  conversationId,
  currentUserId,
  onBack,
  onThreadsMutate,
  onToggleContext,
}: {
  className?: string;
  orgId: string | null;
  thread: InboxThread | null;
  conversationId: string | null;
  currentUserId: string | null;
  onBack?: () => void;
  onThreadsMutate: () => Promise<unknown>;
  onToggleContext: () => void;
}) {
  const {
    messages,
    isLoading,
    send,
    toggleReaction,
    markReadToLatest,
    typingUsers,
    sendTyping,
  } = useConversationMessages(orgId, conversationId);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [composerAccess, setComposerAccess] = useState<"external" | "internal">(
    "external",
  );
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMarkedRef = useRef<string | null>(null);

  const isTicket = thread?.kind === "ticket";

  useEffect(() => {
    setDraft("");
    setReplyTo(null);
    setComposerAccess("external");
    lastMarkedRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const latest = messages[messages.length - 1]!.seq;
    if (lastMarkedRef.current === latest) return;
    lastMarkedRef.current = latest;
    void markReadToLatest().then(() => onThreadsMutate());
  }, [conversationId, messages, markReadToLatest, onThreadsMutate]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      await send(content, {
        ...(replyTo ? { parentMessageId: replyTo.id } : {}),
        ...(isTicket
          ? { access: composerAccess === "internal" ? "internal" : "external" }
          : {}),
      });
      setDraft("");
      setReplyTo(null);
      sendTyping(false);
      await onThreadsMutate();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }, [
    draft,
    sending,
    send,
    replyTo,
    isTicket,
    composerAccess,
    sendTyping,
    onThreadsMutate,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  if (!conversationId || !thread) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 bg-bg-base p-8 text-center",
          className,
        )}
      >
        <p className="text-sm text-fg-tertiary">
          Выберите разговор слева, чтобы открыть переписку.
        </p>
      </div>
    );
  }

  const typingSummary =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0]!.displayName} печатает…`
        : `${typingUsers.length} человек печатают…`;

  return (
    <div className={cn("flex flex-col bg-bg-base", className)}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-fg-secondary hover:text-fg-primary"
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <AssigneeAvatar userId={thread.refId} label={thread.title} size={38} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">
            {thread.title}
          </h2>
          <div className="flex items-center gap-2 text-xs text-fg-tertiary">
            {thread.kind === "work_chat" && thread.linkedIssue ? (
              <Link
                href={`/issues/${thread.linkedIssue.id}`}
                className="font-mono text-chip-info-fg hover:underline"
              >
                {thread.linkedIssue.identifier} → карточка
              </Link>
            ) : isTicket && thread.status ? (
              <span>{thread.status}</span>
            ) : (
              <span>{kindLabel(thread.kind)}</span>
            )}
            {thread.slaBreached ? (
              <span className="flex items-center gap-1 text-danger">
                <AlertTriangle size={12} /> SLA
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleContext}
          aria-label="Контекст"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-fg-secondary hover:text-fg-primary xl:hidden"
        >
          <Info size={16} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-12 w-1/2 animate-pulse rounded-xl bg-bg-elevated"
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="grid flex-1 place-items-center text-sm text-fg-tertiary">
            Сообщений пока нет. Напишите первым.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                sourceKind={thread.kind}
                isOwn={currentUserId !== null && m.authorUserId === currentUserId}
                currentUserId={currentUserId}
                onReply={setReplyTo}
                onToggleReaction={(id, emoji) => void toggleReaction(id, emoji)}
              />
            ))}
          </ul>
        )}
        {typingSummary ? (
          <div className="px-1 text-[11px] text-fg-tertiary">{typingSummary}</div>
        ) : null}
      </div>

      <div className="border-t border-border px-4 py-3">
        {isTicket ? (
          <div className="mb-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setComposerAccess("external")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                composerAccess === "external"
                  ? "bg-accent-muted text-accent"
                  : "text-fg-secondary hover:text-fg-primary",
              )}
            >
              Клиенту
            </button>
            <button
              type="button"
              onClick={() => setComposerAccess("internal")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                composerAccess === "internal"
                  ? "bg-chip-warning-bg text-chip-warning-fg"
                  : "text-fg-secondary hover:text-fg-primary",
              )}
            >
              Заметка
            </button>
          </div>
        ) : null}

        {replyTo ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-bg-surface px-3 py-1.5 text-xs text-fg-secondary">
            <span className="truncate">
              Ответ в ветке: {replyTo.content.slice(0, 60)}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Отменить ответ"
              className="ml-auto text-fg-tertiary hover:text-fg-primary"
            >
              <X size={13} />
            </button>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border bg-bg-surface px-3 py-2",
            isTicket && composerAccess === "internal"
              ? "border-chip-warning-fg/40 bg-chip-warning-bg/10"
              : "border-border",
          )}
        >
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              sendTyping(e.target.value.length > 0);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => sendTyping(false)}
            placeholder={
              isTicket && composerAccess === "internal"
                ? "Внутренняя заметка (клиент не увидит)…"
                : "Написать сообщение…"
            }
            rows={1}
            disabled={sending}
            className="max-h-32 min-h-[40px] resize-none border-0 bg-transparent px-0 focus-visible:ring-0"
          />
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={sending || draft.trim().length === 0}
            aria-label="Отправить"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </div>
        {sendErr ? (
          <div className="mt-1.5 text-xs text-danger">{sendErr}</div>
        ) : null}
        {thread.kind === "external" || isTicket ? (
          <div className="mt-1.5 text-[11px] text-fg-tertiary">
            Текст остаётся у нас. Наружу уходит только уведомление.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextPanel({
  className,
  thread,
  onClose,
}: {
  className?: string;
  thread: InboxThread;
  onClose?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex-col gap-4 overflow-y-auto bg-bg-surface/40 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          Контекст
        </h3>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="text-fg-tertiary hover:text-fg-primary"
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-bg-card p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          Разговор
        </h4>
        <div className="text-sm font-medium text-fg-primary">{thread.title}</div>
        <div className="mt-1 text-xs text-fg-tertiary">
          {kindLabel(thread.kind)}
        </div>
      </div>

      {thread.kind === "ticket" ? (
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
            Обращение
          </h4>
          <div className="flex justify-between border-b border-border py-2 text-xs">
            <span className="text-fg-tertiary">Статус</span>
            <span className="font-medium text-fg-primary">
              {thread.status ?? "—"}
            </span>
          </div>
          <div className="flex justify-between py-2 text-xs">
            <span className="text-fg-tertiary">SLA</span>
            <span
              className={cn(
                "font-medium",
                thread.slaBreached ? "text-danger" : "text-fg-primary",
              )}
            >
              {thread.slaBreached ? "Нарушен" : "В норме"}
            </span>
          </div>
        </div>
      ) : null}

      {thread.kind === "work_chat" && thread.linkedIssue ? (
        <div className="rounded-2xl border border-border bg-bg-card p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
            Связанная задача
          </h4>
          <Link
            href={`/issues/${thread.linkedIssue.id}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-bg-surface px-3 py-2.5 text-sm hover:border-border-strong"
          >
            <ListChecks size={16} className="text-chip-info-fg" />
            <span className="min-w-0">
              <span className="block font-mono text-[11px] text-chip-info-fg">
                {thread.linkedIssue.identifier}
              </span>
              <span className="block truncate text-fg-primary">
                {thread.linkedIssue.title}
              </span>
            </span>
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

function kindLabel(kind: InboxThread["kind"]): string {
  switch (kind) {
    case "dm":
      return "Личный чат";
    case "group":
      return "Группа";
    case "channel":
      return "Рабочий канал";
    case "work_chat":
      return "Чат задачи";
    case "external":
      return "Чат с клиентом";
    case "ticket":
      return "Обращение в поддержку";
    default:
      return "Разговор";
  }
}
