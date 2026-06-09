'use client';

import Link from 'next/link';
import {
  ChevronDown,
  ChevronLeft,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Video,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { chatboxApi } from '@/api/chatbox.api';
import {
  chatboxAnalysisStatusLabel,
  chatboxChannelTypeBadgeClass,
  chatboxChannelTypeLabel,
  chatboxChatStatusLabel,
  mapChatDetail,
  mapMessage,
  type ChatboxMessageView,
  type ChatboxSessionView,
} from '@/domain/chatbox';
import { TierGate } from '@/ui/components/TierGate';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';

const MESSAGES_PAGE = 20;

function formatTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleString('ru-RU');
}

/** Точная пометка отправителя по типу из ChatBox. */
const SENDER_TYPE_LABEL: Record<string, string> = {
  CLIENT: 'Клиент',
  USER: 'Менеджер',
  ASSISTANT: 'ИИ-бот',
  QUALITY_CONTROL: 'Контроль качества',
};
function senderTypeLabel(type: string): string {
  return SENDER_TYPE_LABEL[type] ?? 'Сотрудник';
}

/** Собрать переписку в текст и скачать .txt. */
function exportConversation(
  clientName: string,
  messages: ChatboxMessageView[],
): void {
  const lines = messages.map((m) => {
    const who = `${m.senderName || senderTypeLabel(m.senderType)} (${senderTypeLabel(
      m.senderType,
    )})`;
    const body = m.text ?? `[${m.contentType}]`;
    return `[${formatTime(m.externalCreatedAt)}] ${who}:\n${body}\n`;
  });
  const header = `Переписка с «${clientName || 'Без имени'}»\nЭкспорт из Коры\n${'='.repeat(40)}\n\n`;
  const blob = new Blob([header + lines.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-${clientName || 'export'}.txt`.replace(/\s+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ChatDetailClient({ chatId }: { chatId: string }) {
  return (
    <TierGate feature="feature.chatbox">
      <ChatDetailContent chatId={chatId} />
    </TierGate>
  );
}

function ChatDetailContent({ chatId }: { chatId: string }) {
  const chatSwr = useSWR(
    ['chatbox-chat', chatId],
    async () => {
      const api = await chatboxApi.getChat(chatId);
      return mapChatDetail(api);
    },
    {
      // Живой прогресс: поллим, пока хоть одна сессия в обработке.
      refreshInterval: (data) =>
        data?.sessions.some(
          (s) =>
            s.analysisStatus === 'pending' || s.analysisStatus === 'analyzing',
        )
          ? 4000
          : 0,
    },
  );

  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [messages, setMessages] = useState<ChatboxMessageView[]>([]);
  const [msgLoading, setMsgLoading] = useState(true);
  const [msgError, setMsgError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Первая загрузка: последние MESSAGES_PAGE сообщений (desc → reverse), скролл вниз.
  useEffect(() => {
    let cancelled = false;
    setMsgLoading(true);
    setMsgError(null);
    void (async () => {
      try {
        const res = await chatboxApi.listMessages(chatId, {
          limit: MESSAGES_PAGE,
          offset: 0,
          order: 'desc',
        });
        if (cancelled) return;
        const items = res.items.map(mapMessage).reverse();
        setMessages(items);
        setHasMore(res.total > items.length);
        scrollToBottom();
      } catch (e) {
        if (!cancelled) setMsgError(e);
      } finally {
        if (!cancelled) setMsgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, scrollToBottom]);

  // Подгрузка older при скролле вверх (lazy-load, как в Telegram).
  const loadOlder = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await chatboxApi.listMessages(chatId, {
        limit: MESSAGES_PAGE,
        offset: messages.length,
        order: 'desc',
      });
      const older = res.items.map(mapMessage).reverse();
      setMessages((cur) => [...older, ...cur]);
      setHasMore(res.total > messages.length + older.length);
      // Сохранить позицию скролла после prepend (контент «не прыгает»).
      requestAnimationFrame(() => {
        const cur = scrollRef.current;
        if (cur) cur.scrollTop = cur.scrollHeight - prevHeight;
      });
    } catch {
      /* older-страница не критична — тихо */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [chatId, hasMore, messages.length]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 80) void loadOlder();
  }, [loadOlder]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await chatboxApi.sendMessage(chatId, text);
      toast.success('Отправлено');
      setDraft('');
      // Перезагрузить последнюю страницу + скролл вниз.
      const res = await chatboxApi.listMessages(chatId, {
        limit: MESSAGES_PAGE,
        offset: 0,
        order: 'desc',
      });
      setMessages(res.items.map(mapMessage).reverse());
      setHasMore(res.total > res.items.length);
      scrollToBottom();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === 'chatbox_send_failed'
          ? 'Не удалось отправить'
          : e instanceof ApiError
            ? e.message
            : 'Не удалось отправить';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting, chatId, scrollToBottom]);

  // --- Состояния загрузки/ошибок детали ---
  if (chatSwr.isLoading && !chatSwr.data && !chatSwr.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (chatSwr.error) {
    const code = chatSwr.error instanceof ApiError ? chatSwr.error.code : '';
    const title =
      code === 'forbidden_conversation_access'
        ? 'Нет доступа к переписке'
        : code === 'chatbox_chat_not_found' || code === 'http_404'
          ? 'Чат не найден'
          : 'Не удалось загрузить чат';
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BackLink />
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-6 text-center text-sm text-danger">
          {title}
        </div>
      </div>
    );
  }

  const chat = chatSwr.data;
  if (!chat) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <BackLink />

      {/* Шапка */}
      <header className="mb-4 mt-3 rounded-lg border border-border-subtle bg-bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${chatboxChannelTypeBadgeClass(
              chat.channelType,
            )}`}
          >
            {chatboxChannelTypeLabel(chat.channelType)}
          </span>
          <h1 className="text-lg font-semibold text-fg-primary">
            {chat.clientName || 'Без имени'}
          </h1>
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-xs text-fg-secondary">
            {chatboxChatStatusLabel(chat.status)}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1"
            onClick={() => exportConversation(chat.clientName, messages)}
            disabled={messages.length === 0}
            title="Скачать переписку в .txt"
          >
            <Download size={14} /> Экспорт
          </Button>
        </div>
        <div className="mt-1 text-xs text-fg-tertiary">
          Ответственный: {chat.responsibleName ?? '—'}
        </div>

        {/* Один клиент в разных мессенджерах */}
        {chat.messengerIdentities.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-tertiary">
              Клиент в мессенджерах
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chat.messengerIdentities.map((mi) => (
                <span
                  key={`${mi.channelType}:${mi.externalId}`}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${chatboxChannelTypeBadgeClass(
                    mi.channelType,
                  )}`}
                  title={mi.name}
                >
                  {chatboxChannelTypeLabel(mi.channelType)}
                </span>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* AI-анализ диалога (summary сессий + прогресс) */}
      <AnalysisPanel sessions={chat.sessions} />

      {/* Лента сообщений — свой скролл; вверх подгружаем older (Telegram-style) */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="mb-4 flex h-[60vh] min-h-[280px] flex-col space-y-3 overflow-y-auto rounded-lg border border-border-subtle bg-bg-card p-4"
      >
        {/* Индикатор подгрузки старых сообщений сверху */}
        {hasMore && (
          <div className="flex justify-center py-1 text-xs text-fg-tertiary">
            {loadingMore ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Загружаем…
              </span>
            ) : (
              <span>Прокрутите вверх для старых сообщений</span>
            )}
          </div>
        )}

        {msgLoading && messages.length === 0 && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-2/3 rounded-lg" />
            ))}
          </div>
        )}

        {!!msgError && (
          <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {msgError instanceof ApiError
              ? msgError.message
              : 'Не удалось загрузить сообщения'}
          </div>
        )}

        {!msgLoading && !msgError && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-fg-tertiary">
            В этом чате пока нет сообщений.
          </div>
        )}

        {messages.map((m, idx) => {
          const prev = messages[idx - 1];
          const newSession =
            idx > 0 && prev && prev.sessionId !== m.sessionId;
          return (
            <Fragment key={m.id}>
              {newSession && <SessionDivider />}
              <MessageBubble message={m} />
            </Fragment>
          );
        })}
      </div>

      {/* Ответ менеджера */}
      <div className="rounded-lg border border-border-subtle bg-bg-card p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Напишите ответ клиенту…"
          rows={3}
          disabled={submitting}
          className="mb-2 resize-none"
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void send()}
            disabled={submitting || !draft.trim()}
            className="gap-1"
          >
            {submitting ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="gap-1 text-fg-tertiary">
      <Link href="/chats">
        <ChevronLeft size={16} /> К списку чатов
      </Link>
    </Button>
  );
}

function SessionDivider() {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-fg-tertiary">
      <span className="h-px flex-1 bg-border-subtle" />
      <span>Новая сессия</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

// ─────────────────────────── AI-анализ диалога ──────────────────────────

function sessionPeriod(s: ChatboxSessionView): string {
  const f = (d: Date | null): string => (d ? d.toLocaleDateString('ru-RU') : '');
  const from = f(s.startedAt);
  const to = f(s.endedAt);
  if (from && to && from !== to) return `${from} — ${to}`;
  return from || to || '';
}

function SessionStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'done'
      ? 'bg-success/10 text-success'
      : status === 'failed'
        ? 'bg-danger/10 text-danger'
        : 'bg-bg-card text-fg-secondary';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {chatboxAnalysisStatusLabel(status)}
    </span>
  );
}

function AnalysisPanel({ sessions }: { sessions: ChatboxSessionView[] }) {
  const [open, setOpen] = useState(false);
  const total = sessions.length;
  const done = sessions.filter((s) => s.analysisStatus === 'done').length;
  const inProgress = sessions.some(
    (s) => s.analysisStatus === 'pending' || s.analysisStatus === 'analyzing',
  );

  if (total === 0) {
    return (
      <div className="mb-4 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-card p-3 text-xs text-fg-tertiary">
        <Sparkles size={14} /> AI-анализ: сессий пока нет (анализ ещё не
        запускался — включите его в настройках интеграции).
      </div>
    );
  }

  const ordered = [...sessions].sort((a, b) => b.seq - a.seq);

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-bg-subtle"
      >
        <Sparkles size={16} className="text-accent" />
        <span className="text-sm font-medium text-fg-primary">
          AI-анализ диалога
        </span>
        <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-xs text-fg-secondary">
          {done}/{total} готово
        </span>
        {inProgress && (
          <span className="flex items-center gap-1 text-xs text-fg-tertiary">
            <Loader2 size={12} className="animate-spin" /> обработка…
          </span>
        )}
        <ChevronDown
          size={16}
          className={`ml-auto shrink-0 text-fg-tertiary transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="max-h-[40vh] space-y-3 overflow-y-auto border-t border-border-subtle p-4">
          {ordered.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-border-subtle bg-bg-overlay p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-fg-primary">
                  Сессия #{s.seq}
                </span>
                <SessionStatusBadge status={s.analysisStatus} />
                <span className="text-xs text-fg-tertiary">
                  {sessionPeriod(s)}
                </span>
              </div>
              {s.summary ? (
                <p className="whitespace-pre-wrap text-sm text-fg-secondary">
                  {s.summary}
                </p>
              ) : (
                <p className="text-xs text-fg-tertiary">
                  {s.analysisStatus === 'failed'
                    ? 'Анализ не удался — будет повторён.'
                    : s.analysisStatus === 'done'
                      ? 'Резюме пустое.'
                      : 'В обработке…'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NON_TEXT_LABELS: Record<string, string> = {
  IMAGE: 'Изображение',
  AUDIO: 'Аудио',
  VOICE: 'Голосовое',
  VIDEO: 'Видео',
  VIDEO_NOTE: 'Видеосообщение',
  FILE: 'Файл',
  COMMAND: 'Команда',
};

function attachmentOf(
  m: ChatboxMessageView,
): { url: string | null; label: string; icon: typeof Mic } | null {
  switch (m.contentType) {
    case 'IMAGE':
      return { url: m.imageUrl, label: NON_TEXT_LABELS.IMAGE, icon: ImageIcon };
    case 'VOICE':
      return { url: m.audioUrl, label: NON_TEXT_LABELS.VOICE, icon: Mic };
    case 'AUDIO':
      return { url: m.audioUrl, label: NON_TEXT_LABELS.AUDIO, icon: Mic };
    case 'VIDEO':
      return { url: m.videoUrl, label: NON_TEXT_LABELS.VIDEO, icon: Video };
    case 'VIDEO_NOTE':
      return {
        url: m.videoUrl,
        label: NON_TEXT_LABELS.VIDEO_NOTE,
        icon: Video,
      };
    case 'FILE':
      return { url: m.fileUrl, label: NON_TEXT_LABELS.FILE, icon: FileText };
    default:
      return null;
  }
}

function MessageBubble({ message }: { message: ChatboxMessageView }) {
  // Сообщения, отправленные из Коры, всегда менеджерские.
  const isManager = message.isOutboundFromKora || message.senderRole === 'manager';
  const attachment = attachmentOf(message);

  const bubbleClass = isManager
    ? 'bg-accent text-accent-fg'
    : 'border border-border-subtle bg-bg-overlay text-fg-primary';
  const metaClass = isManager ? 'text-accent-fg/70' : 'text-fg-tertiary';
  const badgeClass = isManager
    ? 'bg-accent-fg/15 text-accent-fg'
    : 'bg-bg-card text-fg-secondary';

  return (
    <div className={`flex ${isManager ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${bubbleClass}`}>
        <div className="mb-1 flex items-center gap-1.5">
          {message.senderPersonId ? (
            <Link
              href={`/persons/${message.senderPersonId}`}
              className="text-xs font-semibold underline-offset-2 hover:underline"
              title="Открыть профиль сотрудника"
            >
              {message.senderName || senderTypeLabel(message.senderType)}
            </Link>
          ) : (
            <span className="text-xs font-semibold">
              {message.senderName || senderTypeLabel(message.senderType)}
            </span>
          )}
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium ${badgeClass}`}
          >
            {senderTypeLabel(message.senderType)}
          </span>
        </div>

        {attachment ? (
          <div className="flex items-center gap-1.5">
            <attachment.icon size={14} />
            {attachment.url ? (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                [{attachment.label}]
              </a>
            ) : (
              <span>[{attachment.label}]</span>
            )}
          </div>
        ) : null}

        {message.text ? (
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        ) : null}

        <div className={`mt-0.5 text-[10px] ${metaClass}`}>
          {formatTime(message.externalCreatedAt)}
        </div>
      </div>
    </div>
  );
}
