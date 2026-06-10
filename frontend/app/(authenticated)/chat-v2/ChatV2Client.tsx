'use client';

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
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';

import { chatV2Api } from '@/api/chat-v2.api';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import {
  chatV2ConversationStatusLabel,
  chatV2ModeLabel,
  chatV2ScopeLabel,
  formatTimestamp,
  stripContextMarkers,
  toChatV2Conversation,
  toChatV2ConversationWithMessages,
  type ChatV2Conversation,
  type ChatV2ConversationStatus,
  type ChatV2ConversationWithMessages,
  type ChatV2Message,
} from '@/domain/chat-v2';

/**
 * SBA α-5 — UI чата-v2.
 *
 * Master-detail: слева список диалогов (с фильтром active/archived и
 * закреплёнными вверху), справа — поток сообщений и input. Создание
 * нового диалога — кнопкой «+».
 *
 * Citations отрисовываются в виде bubble под сообщением assistant
 * (заголовок встречи + timestamp + snippet).
 */
export function ChatV2Client(): ReactElement {
  const searchParams = useSearchParams();
  // Deep-link `/chat-v2?conversationId=...` (Wave 2 finishing) — позволяет
  // CommandPalette и другим местам вести напрямую в нужный диалог. Захватываем
  // ровно один раз на mount: если параметр пришёл — preselect; пользователь
  // дальше может свободно переключаться по списку.
  const initialConversationId = useMemo(
    () => searchParams?.get('conversationId') ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId,
  );
  const [statusFilter, setStatusFilter] = useState<ChatV2ConversationStatus>(
    'active',
  );

  const listKey = `chat-v2:conversations:${statusFilter}`;
  const list = useSWR(listKey, async () => {
    const dto = await chatV2Api.listConversations({ status: statusFilter, limit: 50 });
    return {
      items: dto.items.map(toChatV2Conversation),
      total: dto.total,
    };
  });

  // Если конкретный conversationId пришёл по deep-link, но он лежит в архиве —
  // переключаем фильтр, чтобы запись была видна в master-списке. Делаем это
  // лениво: пробуем active, если не нашли — переключаемся на archived.
  useEffect(() => {
    if (!initialConversationId) return;
    if (!list.data) return;
    const found = list.data.items.some((c) => c.id === initialConversationId);
    if (!found && statusFilter === 'active') {
      setStatusFilter('archived');
    }
  }, [initialConversationId, list.data, statusFilter]);

  // Auto-select первый диалог при загрузке (только если deep-link не задал).
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
      {/* Master */}
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
            {(['active', 'archived'] as ChatV2ConversationStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded px-2 py-1 text-xs ${
                  statusFilter === s
                    ? 'bg-accent text-accent-fg'
                    : 'bg-bg text-fg-secondary hover:bg-surface-hover'
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
              {statusFilter === 'active'
                ? 'Пока нет диалогов. Задайте первый вопрос справа.'
                : 'В архиве пусто.'}
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

      {/* Detail */}
      <main className="flex flex-1 flex-col">
        <ConversationDetail
          conversationId={selectedId}
          onConversationCreated={(id) => {
            setSelectedId(id);
            void list.mutate();
          }}
          onConversationChanged={() => {
            void list.mutate();
          }}
        />
      </main>
    </div>
  );
}

// ───────────────────────── Master items ─────────────────────────

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
        active ? 'bg-accent/10' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="truncate font-medium text-fg-primary">
          {conversation.title ?? 'Новый диалог'}
        </div>
        {conversation.pinnedAt ? (
          <Pin size={12} className="text-fg-tertiary shrink-0" />
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
        <span>{chatV2ScopeLabel(conversation.scope)}</span>
        <span>·</span>
        <span>{conversation.updatedAt.toLocaleDateString('ru-RU')}</span>
      </div>
    </button>
  );
}

// ───────────────────────── Detail ─────────────────────────

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

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SBA α-5 dialog-layer — temporal query (advanced).
  const [validAt, setValidAt] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // SBA α-5 dialog-layer — последний ответ был cache hit?
  const [lastCacheHit, setLastCacheHit] = useState<boolean>(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    setSending(true);
    setError(null);
    setLastCacheHit(false);
    try {
      // Если задан validAt — конвертим из datetime-local в ISO.
      const asOfIso = validAt
        ? new Date(validAt).toISOString()
        : undefined;
      const response = await chatV2Api.ask({
        question,
        conversationId: conversationId ?? undefined,
        ...(asOfIso ? { asOf: asOfIso } : {}),
      });
      setInput('');
      setLastCacheHit(response.cacheHit);
      if (!conversationId) {
        onConversationCreated(response.conversationId);
      } else {
        // refresh
        await detail.mutate();
        onConversationChanged();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось получить ответ';
      setError(msg);
    } finally {
      setSending(false);
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
      title: 'Архивировать этот диалог?',
      confirmLabel: 'Архивировать',
    });
    if (!ok) return;
    await chatV2Api.archiveConversation(detail.data.id);
    onConversationChanged();
  }

  const messages = useMemo<ChatV2Message[]>(
    () => detail.data?.messages ?? [],
    [detail.data],
  );

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-bg px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-accent" />
          <h1 className="text-lg font-semibold">
            {detail.data?.title ?? (conversationId ? 'Новый диалог' : 'Помощник компании')}
          </h1>
        </div>
        {detail.data ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePin}
              className="rounded p-1.5 text-fg-secondary hover:bg-surface-hover"
              title={detail.data.pinnedAt ? 'Открепить' : 'Закрепить'}
            >
              {detail.data.pinnedAt ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
            {detail.data.status === 'active' ? (
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-bg">
        {!conversationId ? (
          <EmptyState />
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
          <div className="text-sm italic text-fg-tertiary">Кора печатает ответ...</div>
        ) : null}
        {lastCacheHit ? (
          <div className="inline-flex items-center gap-1 rounded-full bg-chip-success-bg px-2 py-0.5 text-xs text-chip-success-fg self-start">
            <span aria-hidden>•</span>
            <span>Ответ из кэша (мгновенно)</span>
          </div>
        ) : null}
        {error ? (
          <div className="rounded bg-chip-danger-bg px-3 py-2 text-sm text-chip-danger-fg">
            Ошибка: {error}
          </div>
        ) : null}
      </div>

      {/* Input */}
      <form
        onSubmit={onSubmit}
        // Нижний/правый отступ оставляет место плавающей кнопке «Помощник
        // компании» (AssistantSidebar FAB, fixed bottom-6 right-6), чтобы она
        // не перекрывала кнопку отправки и поле ввода.
        className="border-t border-border bg-surface p-3 pb-20 sm:pr-20 flex flex-col gap-2"
      >
        {/* SBA α-5 dialog-layer — advanced: temporal query (validAt). */}
        <div className="flex items-center justify-between text-xs text-fg-tertiary">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="underline-offset-2 hover:underline"
          >
            {showAdvanced ? 'Скрыть' : 'Дополнительно'}
          </button>
          {showAdvanced ? (
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
                  onClick={() => setValidAt('')}
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
          placeholder="Спросите Кору о памяти компании..."
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
  const isUser = message.role === 'user';
  const displayText = isUser ? message.text : stripContextMarkers(message.text);
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-accent text-accent-fg'
            : 'bg-surface border border-border text-fg-primary'
        }`}
      >
        {!isUser && message.mode ? (
          <div className="mb-1 text-xs text-fg-tertiary">
            Режим: {chatV2ModeLabel(message.mode)}
          </div>
        ) : null}
        <div>{displayText}</div>

        {!isUser && message.citations.length > 0 ? (
          <div className="mt-3 space-y-1.5 border-t border-border pt-2">
            <div className="text-xs font-medium text-fg-tertiary">Источники:</div>
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
                      Документ: {c.documentName ?? 'без названия'}
                    </Link>
                  </div>
                ) : (
                  <div className="font-medium">
                    {c.meetingTitle}{' '}
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

/**
 * TZ-3 Ф3 — оценка ответа ассистента (👍/👎). Тонкий ряд под сообщением.
 * Optimistic local state: при клике сразу подсвечиваем выбор и шлём запрос
 * fire-and-forget; при ошибке откатываем. Повторный клик по активной кнопке
 * снимает оценку (DELETE). Channel-agnostic эндпоинт на бэке поддерживает оба.
 */
function MessageFeedback({ messageId }: { messageId: string }): ReactElement {
  const [helpful, setHelpful] = useState<'up' | 'down' | null>(null);

  function vote(next: 'up' | 'down'): void {
    const prev = helpful;
    if (prev === next) {
      // Повторный клик по активной — снять оценку.
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
        onClick={() => vote('up')}
        title="Ответ помог"
        aria-label="Ответ помог"
        aria-pressed={helpful === 'up'}
        className={`rounded p-1 transition-colors hover:bg-surface-hover ${
          helpful === 'up' ? 'text-accent' : 'text-fg-tertiary'
        }`}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => vote('down')}
        title="Ответ не помог"
        aria-label="Ответ не помог"
        aria-pressed={helpful === 'down'}
        className={`rounded p-1 transition-colors hover:bg-surface-hover ${
          helpful === 'down' ? 'text-danger' : 'text-fg-tertiary'
        }`}
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  );
}
