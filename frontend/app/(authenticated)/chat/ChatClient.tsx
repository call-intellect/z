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
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { cn } from '@/ui/shadcn/lib/utils';
import { AiTypingDots } from '@/ui/components/ai/AiTypingDots';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitationApi[];
};

/**
 * `/chat` — единый AI-чат поверх ядра знаний (org-scope).
 *
 * Бэкенд переключается между ChatV2 и legacy через ENV `CHAT_V2_ENABLED`.
 * Фронт пробует унифицированный эндпоинт `POST /api/v1/chat/v2` и при 503
 * `chat_v2_disabled` делает graceful fallback на legacy `POST /api/v1/chat`.
 * Так UI работает на любом окружении без знания флага.
 */
export function ChatClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // История диалога — общая (legacy эндпоинт работает с обоими провайдерами).
  useEffect(() => {
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
  }, []);

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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6">
      <header className="mb-4 flex items-center gap-2">
        <MessageCircle size={20} className="text-accent" />
        <div>
          <h1 className="text-2xl font-semibold">AI-чат</h1>
          <p className="text-sm text-fg-tertiary">
            Задайте вопрос по всему архиву встреч и знаний организации. AI
            подбирает релевантные блоки и отвечает с цитатами.
          </p>
        </div>
      </header>

      <div className="flex flex-1 min-h-[500px] flex-col rounded-xl border border-border-subtle bg-bg-elevated">
        <ScrollArea className="flex-1 px-4">
          {!historyLoaded ? (
            <div className="py-8 text-center text-sm text-fg-tertiary">
              <Loader2 size={16} className="mx-auto mb-2 animate-spin" />
              Загрузка истории…
            </div>
          ) : messages.length === 0 ? (
            <EmptyHint />
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
        <div className="border-t border-border-subtle p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
              placeholder="Спросите про команду, сделки, продукт, риски…"
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
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="py-12 text-center">
      <h3 className="mb-2 text-base font-medium">С чего начать</h3>
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
        <p className="whitespace-pre-wrap">{message.content}</p>
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
