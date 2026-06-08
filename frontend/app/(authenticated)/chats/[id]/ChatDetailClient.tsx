'use client';

import Link from 'next/link';
import {
  ChevronLeft,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Send,
  Video,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { chatboxApi } from '@/api/chatbox.api';
import {
  chatboxChannelTypeBadgeClass,
  chatboxChannelTypeLabel,
  chatboxChatStatusLabel,
  mapChatDetail,
  mapMessage,
  type ChatboxMessageView,
} from '@/domain/chatbox';
import { TierGate } from '@/ui/components/TierGate';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';

const MESSAGES_LIMIT = 500;

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
  const chatSwr = useSWR(['chatbox-chat', chatId], async () => {
    const api = await chatboxApi.getChat(chatId);
    return mapChatDetail(api);
  });

  const messagesSwr = useSWR(['chatbox-messages', chatId], async () => {
    const res = await chatboxApi.listMessages(chatId, { limit: MESSAGES_LIMIT });
    return res.items.map(mapMessage);
  });

  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = messagesSwr.data?.length ?? 0;

  // Автоскролл к последнему сообщению при загрузке/обновлении ленты.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await chatboxApi.sendMessage(chatId, text);
      toast.success('Отправлено');
      setDraft('');
      await messagesSwr.mutate();
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
  }, [draft, submitting, chatId, messagesSwr]);

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

  const messages = messagesSwr.data ?? [];

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

      {/* Лента сообщений — скроллится сама, страница не растёт */}
      <div className="mb-4 h-[60vh] min-h-[280px] space-y-3 overflow-y-auto rounded-lg border border-border-subtle bg-bg-card p-4">
        {messagesSwr.isLoading && !messagesSwr.data && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-2/3 rounded-lg" />
            ))}
          </div>
        )}

        {messagesSwr.error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {messagesSwr.error instanceof ApiError
              ? messagesSwr.error.message
              : 'Не удалось загрузить сообщения'}
          </div>
        )}

        {!messagesSwr.isLoading &&
          !messagesSwr.error &&
          messages.length === 0 && (
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
        <div ref={bottomRef} />
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
    ? 'bg-accent text-white'
    : 'border border-border-subtle bg-bg-overlay text-fg-primary';
  const metaClass = isManager ? 'text-white/70' : 'text-fg-tertiary';
  const badgeClass = isManager
    ? 'bg-white/20 text-white'
    : 'bg-bg-card text-fg-secondary';

  return (
    <div className={`flex ${isManager ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${bubbleClass}`}>
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-xs font-semibold">
            {message.senderName || senderTypeLabel(message.senderType)}
          </span>
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
