'use client';

/**
 * AI-чат по конкретной встрече. Правая колонка на странице результата.
 * Поддерживает коллапс (persist в localStorage), suggested prompts,
 * citations с кликабельным переходом в плеер.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, RefreshCw, Send, Sparkles } from 'lucide-react';

import { useMeetingChat } from '@/hooks/use-meeting-chat';
import { AiCitation } from '@/ui/components/ai/AiCitation';
import { AiTypingDots } from '@/ui/components/ai/AiTypingDots';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { cn } from '@/ui/shadcn/lib/utils';

const COLLAPSE_KEY = 'z:ai-chat-collapsed';

const SUGGESTED_PROMPTS = [
  'Что мы решили?',
  'Какие риски обсудили?',
  'Сделай follow-up',
  'Кто принимает решение?',
];

export type MeetingChatPanelProps = {
  meetingId: string;
  onSeek?: (ms: number) => void;
};

export function MeetingChatPanel({ meetingId, onSeek }: MeetingChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Восстанавливаем состояние коллапса из localStorage при mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // ignore (private mode)
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const { messages, thinking, send, retry, historyLoading } =
    useMeetingChat(meetingId);

  // Автоскролл вниз на новые сообщения / typing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, thinking]);

  const onSubmit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void send(text);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Открыть AI-помощника"
        onClick={toggleCollapsed}
        className="sticky top-24 grid h-14 w-14 place-items-center self-start rounded-xl border border-accent-border bg-accent-muted text-accent transition-colors hover:bg-accent-muted-strong"
      >
        <Sparkles size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <aside
      className="sticky top-24 flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-card"
      aria-label="AI-чат по встрече"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-accent-muted text-accent">
          <Sparkles size={14} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg-primary">
            AI-чат по встрече
          </div>
          <div className="text-xs text-fg-tertiary">контекст · эта встреча</div>
        </div>
        <button
          type="button"
          aria-label="Свернуть"
          onClick={toggleCollapsed}
          className="grid h-8 w-8 place-items-center rounded-md text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* History */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-4 px-4 py-5">
          {historyLoading && messages.length === 0 ? (
            <div className="text-center text-xs text-fg-tertiary">
              Загружаю историю...
            </div>
          ) : null}

          {messages.length === 0 && !historyLoading && !thinking && (
            <EmptyChat onPick={(p) => setInput(p)} />
          )}

          {messages.map((m) => {
            if (m.role === 'user') {
              return (
                <UserMessage
                  key={m.id}
                  text={m.content}
                  failed={m.failed === true}
                  onRetry={() => retry(m.id)}
                />
              );
            }
            return (
              <AssistantMessage
                key={m.id}
                text={m.content}
                citations={m.citations}
                onSeek={onSeek}
              />
            );
          })}

          <AnimatePresence>{thinking && <ChatTypingDots />}</AnimatePresence>
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border-subtle p-3">
        {messages.length === 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setInput(p)}
                className="rounded-full border border-border-subtle bg-bg-overlay px-2.5 py-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="flex items-end gap-2 rounded-xl border border-border-subtle bg-bg-overlay p-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Спросите про эту встречу..."
            rows={1}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-fg-primary outline-none placeholder:text-fg-tertiary"
          />
          <button
            type="submit"
            aria-label="Отправить"
            disabled={!input.trim() || thinking}
            className={cn(
              'grid h-8 w-8 place-items-center rounded-full transition-all',
              input.trim() && !thinking
                ? 'bg-accent text-accent-fg shadow-glow-mint'
                : 'bg-bg-card text-fg-tertiary',
            )}
          >
            <Send size={14} strokeWidth={2} />
          </button>
        </form>
        <div className="mt-2 flex justify-between text-[10px] text-fg-tertiary">
          <span>Enter — отправить · Shift+Enter — новая строка</span>
        </div>
      </div>
    </aside>
  );
}

function EmptyChat({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex flex-col gap-3 py-6 text-center">
      <div className="text-sm text-fg-secondary">
        Спросите AI-ассистента про эту встречу. Ответы будут со ссылками на моменты записи.
      </div>
      <div className="mx-auto flex flex-wrap justify-center gap-1.5">
        {SUGGESTED_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-full border border-border-subtle bg-bg-overlay px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:text-accent"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({
  text,
  failed,
  onRetry,
}: {
  text: string;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-end gap-1"
    >
      <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-border-subtle bg-bg-overlay px-3.5 py-2.5 text-sm leading-relaxed text-fg-primary">
        {text}
      </div>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger/80"
        >
          <RefreshCw size={11} />
          Не доставлено · повторить
        </button>
      )}
    </motion.div>
  );
}

function AssistantMessage({
  text,
  citations,
  onSeek,
}: {
  text: string;
  citations: { startMs: number; speakerName: string | null; snippet: string }[];
  onSeek?: (ms: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="flex flex-col gap-2.5"
    >
      <div className="flex items-start gap-2.5">
        <div className="grid h-5 w-5 shrink-0 place-items-center rounded bg-accent-muted text-accent">
          <Sparkles size={12} strokeWidth={1.75} />
        </div>
        <div className="text-sm leading-relaxed text-fg-primary">{text}</div>
      </div>
      {citations.length > 0 && (
        <div className="ml-7 flex flex-col gap-2">
          {citations.map((c, i) => (
            <AiCitation
              key={i}
              startMs={c.startMs}
              speakerName={c.speakerName ?? 'Спикер'}
              text={c.snippet}
              onClick={onSeek ? () => onSeek(c.startMs) : undefined}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ChatTypingDots() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="ml-7 flex items-center gap-2 text-xs text-fg-tertiary"
    >
      <AiTypingDots />
      <span>думает...</span>
    </motion.div>
  );
}

