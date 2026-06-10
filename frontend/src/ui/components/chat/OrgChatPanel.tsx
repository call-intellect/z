'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';

import {
  chatApi,
  type ChatCitationApi,
  type ChatMessageApi,
} from '@/api/chat.api';
import { ApiError } from '@/api/api-error';
import { stripContextMarkers } from '@/domain/chat-v2';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { cn } from '@/ui/shadcn/lib/utils';
import { AiTypingDots } from '@/ui/components/ai/AiTypingDots';

/**
 * Общий компонент org-scope AI-чата (Фаза 8 шаг 5).
 *
 * Используется на двух страницах:
 *   - `/chat` — выделенная страница чата (`withHistory=true`).
 *   - `/dashboard` (вид директора) — встроенный inline-блок Q&A
 *     (`withHistory=false`, ad-hoc подсказки).
 *
 * Источник правды:
 *   - `chatApi.askV2({scope:'org', query})` — основной путь (Фаза 6).
 *   - При 503 `chat_v2_disabled` — graceful fallback на legacy
 *     `chatApi.sendGlobal({message})`.
 *   - История — `chatApi.historyGlobal()` (общий cross-history).
 *
 * Контракт props:
 *   - `withHistory` (default `true`) — подгружать ли сохранённую историю.
 *     На дашборде директора отключаем, чтобы не путать с длинной историей
 *     `/chat`.
 *   - `height` — фиксированная высота области сообщений (CSS-значение
 *     для inline-style). По умолчанию — высота на остаток flex-родителя.
 *   - `placeholder` — кастомный плейсхолдер для textarea.
 *   - `intro` — кастомная подсказка в пустом состоянии.
 */
export type OrgChatPanelProps = {
  withHistory?: boolean;
  height?: string;
  placeholder?: string;
  intro?: React.ReactNode;
  /** Доп.класс на корневой контейнер (обёртка `.flex.flex-col`). */
  className?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitationApi[];
};

export function OrgChatPanel({
  withHistory = true,
  height,
  placeholder = 'Спросите про команду, сделки, продукт, риски…',
  intro,
  className,
}: OrgChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(!withHistory);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // История диалога — только если запрошена.
  useEffect(() => {
    if (!withHistory) return;
    let cancelled = false;
    chatApi
      .historyGlobal()
      .then((res) => {
        if (cancelled) return;
        const items: ChatMessage[] = res.items.map(apiMessageToUi);
        setMessages(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [withHistory]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    try {
      const res = await sendOrgChatWithFallback(text);
      const aiMsg: ChatMessage = {
        id: `local-ai-${Date.now()}`,
        role: 'assistant',
        content: res.message,
        citations: res.citations,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Ошибка чата';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border-subtle bg-bg-elevated',
        className,
      )}
      style={height ? { height } : undefined}
    >
      <ScrollArea className="flex-1 px-4">
        {!historyLoaded ? (
          <div className="py-8 text-center text-sm text-fg-tertiary">
            <Loader2 size={16} className="mx-auto mb-2 animate-spin" />
            Загрузка истории…
          </div>
        ) : messages.length === 0 ? (
          intro ?? <DefaultEmptyHint />
        ) : (
          <div className="flex flex-col gap-3 py-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-bg-overlay px-3 py-2">
                  <AiTypingDots />
                </div>
              </div>
            )}
            <div ref={scrollAnchorRef} />
          </div>
        )}
      </ScrollArea>
      <div className="border-t border-border-subtle p-3 pb-20 sm:pr-20">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            placeholder={placeholder}
            rows={2}
            className="resize-none"
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            size="icon"
            aria-label="Отправить"
          >
            <Send size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DefaultEmptyHint() {
  return (
    <div className="py-12 text-center">
      <h3 className="mb-2 flex items-center justify-center gap-2 text-base font-medium">
        <MessageCircle size={16} className="text-accent" /> С чего начать
      </h3>
      <ul className="mx-auto inline-flex flex-col gap-1 text-left text-sm text-fg-tertiary">
        <li>— «О чём договорились с Acme в прошлый раз?»</li>
        <li>— «Какие сейчас риски у проекта Z?»</li>
        <li>— «Что обещал команде Иван за последний месяц?»</li>
      </ul>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          isUser ? 'bg-accent text-accent-fg' : 'bg-bg-overlay text-fg-primary',
        )}
      >
        <p className="whitespace-pre-wrap">
          {isUser ? message.content : stripContextMarkers(message.content)}
        </p>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.citations.map((c, i) => (
              <Link
                key={`${c.meetingId}-${c.startMs}-${i}`}
                href={`/meetings/${encodeURIComponent(c.meetingId)}/result`}
                className="inline-flex max-w-full items-center rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-fg-secondary hover:border-accent/60 hover:text-accent"
                title={c.snippet}
              >
                <span className="truncate">{c.meetingTitle ?? 'Встреча'}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Отправка org-вопроса с graceful fallback:
 *   1. POST /api/v1/chat/v2 (scope='org', query=text).
 *   2. Если 503 chat_v2_disabled — POST /api/v1/chat (legacy).
 * Возвращает унифицированный shape {message, citations}.
 */
async function sendOrgChatWithFallback(
  text: string,
): Promise<{ message: string; citations: ChatCitationApi[] }> {
  try {
    const res = await chatApi.askV2({ scope: 'org', query: text });
    return { message: res.message, citations: res.citations };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'chat_v2_disabled') {
      const res = await chatApi.sendGlobal({ message: text });
      return { message: res.message, citations: res.citations };
    }
    throw err;
  }
}

function apiMessageToUi(m: ChatMessageApi): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations: Array.isArray(m.citations) ? m.citations : [],
  };
}
