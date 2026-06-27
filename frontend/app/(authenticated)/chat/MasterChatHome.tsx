"use client";

import { Loader2, MessageCircle, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useSearchParams } from "next/navigation";

import { useConciergeConversations } from "@/hooks/useConciergeConversations";
import type { ConciergeConversationListItem } from "@/domain/concierge-conversation";
import { MasterConversation } from "./MasterConversation";

export function MasterChatHome(): ReactElement {
  const searchParams = useSearchParams();
  const initialConversationId = useMemo(
    () => searchParams?.get("conversationId") ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const prefill = useMemo(
    () => searchParams?.get("prefill") ?? undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const list = useConciergeConversations();

  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId,
  );
  const [openedId, setOpenedId] = useState<string | null>(initialConversationId);
  const [sessionKey, setSessionKey] = useState(0);
  const [composingNew, setComposingNew] = useState(!initialConversationId);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setOpenedId(id);
    setComposingNew(false);
    setSessionKey((k) => k + 1);
  }, []);

  const handleCompose = useCallback(() => {
    setSelectedId(null);
    setOpenedId(null);
    setComposingNew(true);
    setSessionKey((k) => k + 1);
  }, []);

  const handleStarted = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleChanged = useCallback(() => {
    void list.mutate();
  }, [list]);

  const showConversation = composingNew || openedId !== null;

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-80 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Чаты с Мастером</h2>
            <button
              type="button"
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent/90"
              onClick={handleCompose}
            >
              <Plus size={14} className="inline" /> Новый диалог
            </button>
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
          ) : !list.data || list.data.length === 0 ? (
            <div className="p-6 text-center text-sm text-fg-tertiary">
              Пока нет диалогов. Задайте первый вопрос справа.
            </div>
          ) : (
            list.data.map((c) => (
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

      <main className="flex flex-1 flex-col">
        {showConversation ? (
          <MasterConversation
            key={sessionKey}
            conversationId={openedId ?? undefined}
            initialInput={composingNew ? prefill : undefined}
            onConversationStarted={handleStarted}
            onConversationChanged={handleChanged}
          />
        ) : (
          <EmptyHome onCompose={handleCompose} />
        )}
      </main>
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  onClick,
}: {
  conversation: ConciergeConversationListItem;
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
      <div className="truncate font-medium text-fg-primary">
        {conversation.title}
      </div>
      <div className="mt-0.5 text-xs text-fg-tertiary">
        {conversation.lastMessageAt
          ? conversation.lastMessageAt.toLocaleDateString("ru-RU")
          : conversation.startedAt.toLocaleDateString("ru-RU")}
      </div>
    </button>
  );
}

function EmptyHome({
  onCompose,
}: {
  onCompose: () => void;
}): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-fg-tertiary">
      <div className="max-w-md text-center">
        <MessageCircle size={32} className="mx-auto mb-3 text-accent" />
        <h2 className="text-lg font-semibold text-fg-primary">
          Выберите диалог или начните новый
        </h2>
        <button
          type="button"
          onClick={onCompose}
          className="mt-3 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
        >
          Новый диалог
        </button>
      </div>
    </div>
  );
}
