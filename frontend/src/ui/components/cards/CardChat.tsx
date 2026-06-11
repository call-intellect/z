'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { cardsApi } from '@/api/cards.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { cn } from '@/ui/shadcn/lib/utils';
import { AiTypingDots } from '@/ui/components/ai/AiTypingDots';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{
    meetingId: string;
    meetingTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;
  }>;
};

/**
 * AI-чат по карточке. RAG-режим: бэкенд ищет релевантные кусочки транскрипта
 * среди встреч карточки и отвечает с цитатами.
 */
export function CardChat({ cardId }: { cardId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // Загружаем историю один раз.
  useEffect(() => {
    let cancelled = false;
    cardsApi
      .chatHistory(cardId)
      .then((res) => {
        if (cancelled) return;
        const items: Message[] = res.items.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: extractCitations(m.citations),
        }));
        setMessages(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const userMsg: Message = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    try {
      const res = await cardsApi.ask(cardId, text);
      const aiMsg: Message = {
        id: `local-ai-${Date.now()}`,
        role: 'assistant',
        content: res.message,
        citations: res.citations,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const msg = humanizeApiError(err, 'Ошибка чата');
      toast.error(msg);
      // Сообщение пользователя оставляем в ленте — оно ушло на сервер.
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
    <div className="flex h-full min-h-[400px] flex-col rounded-xl border border-border-subtle bg-bg-elevated">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Sparkles size={16} className="text-accent" />
        <h3 className="text-sm font-medium">Чат с архивом карточки</h3>
      </div>
      <ScrollArea className="flex-1 px-4">
        {!historyLoaded ? (
          <div className="py-8 text-center text-sm text-fg-tertiary">
            Загрузка истории…
          </div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-fg-tertiary">
            Спросите что-то про встречи этой карточки.
            <br />
            Например: «о чём говорили в прошлый раз» или «какие открытые
            обещания».
          </div>
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
            placeholder="Спросить про карточку…"
            rows={2}
            className="resize-none"
          />
          <Button
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            size="icon"
          >
            <Send size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
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
                key={`${c.meetingId}-${i}`}
                href={`/meetings/${encodeURIComponent(c.meetingId)}/result`}
                className="inline-flex max-w-full items-center rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-fg-secondary hover:border-accent/60 hover:text-accent"
                title={c.snippet}
              >
                <span className="truncate">{c.meetingTitle}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function extractCitations(raw: unknown): Message['citations'] {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(
      (x): x is { meetingId: string; meetingTitle: string; startMs: number; endMs: number; snippet: string } =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as Record<string, unknown>).meetingId === 'string' &&
        typeof (x as Record<string, unknown>).meetingTitle === 'string' &&
        typeof (x as Record<string, unknown>).startMs === 'number' &&
        typeof (x as Record<string, unknown>).endMs === 'number',
    )
    .map((c) => ({
      meetingId: c.meetingId,
      meetingTitle: c.meetingTitle,
      startMs: c.startMs,
      endMs: c.endMs,
      snippet: typeof c.snippet === 'string' ? c.snippet : '',
    }));
}
