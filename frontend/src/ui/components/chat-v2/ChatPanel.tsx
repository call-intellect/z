"use client";

import Link from "next/link";
import { MessageCircle, Send } from "lucide-react";
import { useState, type FormEvent, type ReactElement } from "react";

import {
  chatV2Api,
  type ChatV2ModeApi,
  type ChatV2ScopeApi,
} from "@/api/chat-v2.api";
import {
  citationDeepLink,
  formatTimestamp,
  type ChatV2Citation,
} from "@/domain/chat-v2";
import { AssistantMarkdown } from "./AssistantMarkdown";

export interface ChatPanelProps {
  conversationId?: string;
  scope: ChatV2ScopeApi;
  scopeRefId?: string | null;
  mode?: ChatV2ModeApi;
  placeholder?: string;
  className?: string;
}

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: ChatV2Citation[];
  uncertaintyNote?: string | null;
  mode?: ChatV2ModeApi;
}

export function ChatPanel(props: ChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(
    props.conversationId,
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setError(null);
    setLoading(true);
    const tempId = `local-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", text: question },
    ]);
    setInput("");
    try {
      const response = await chatV2Api.ask({
        question,
        conversationId,
        scope: props.scope,
        scopeRefId: props.scopeRefId ?? undefined,
        mode: props.mode,
      });
      setConversationId(response.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: response.messageId,
          role: "assistant",
          text: response.text,
          citations: response.citations as ChatV2Citation[],
          uncertaintyNote: response.uncertaintyNote,
          mode: response.mode,
        },
      ]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Не удалось получить ответ";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`flex flex-col rounded-lg border border-border bg-surface ${props.className ?? ""}`}
    >
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-fg-tertiary text-sm">
            <div className="text-center">
              <MessageCircle className="mx-auto mb-2" size={24} />
              <div>
                Задайте вопрос — Кора ответит с цитатами из памяти компании.
              </div>
            </div>
          </div>
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}
        {loading ? (
          <div className="text-fg-tertiary text-sm italic">
            Кора печатает ответ...
          </div>
        ) : null}
        {error ? (
          <div className="rounded bg-chip-danger-bg px-3 py-2 text-sm text-chip-danger-fg">
            Ошибка: {error}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-border p-3 pb-20 sm:pr-20 flex gap-2"
      >
        <input
          type="text"
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={props.placeholder ?? "Спросите Кору..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ message }: { message: LocalMessage }): ReactElement {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "whitespace-pre-wrap bg-accent text-accent-fg"
            : "bg-bg border border-border text-fg-primary"
        }`}
      >
        {!isUser ? (
          <div className="text-xs text-fg-tertiary mb-1">✨ Мастер Кора</div>
        ) : null}
        {isUser ? (
          <div>{message.text}</div>
        ) : (
          <AssistantMarkdown text={message.text} />
        )}
        {!isUser && message.uncertaintyNote ? (
          <div className="mt-2 rounded bg-chip-warning-bg px-2 py-1 text-xs text-chip-warning-fg">
            {message.uncertaintyNote}
          </div>
        ) : null}
        {!isUser && message.citations && message.citations.length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-border pt-2">
            <div className="text-xs font-medium text-fg-tertiary">
              Источники:
            </div>
            {message.citations.map((c, idx) => {
              const href = citationDeepLink(c);
              const inner = (
                <>
                  <div className="font-medium">
                    {c.meetingTitle}{" "}
                    <span className="text-fg-tertiary">
                      [{formatTimestamp(c.startMs)}]
                    </span>
                  </div>
                  <div className="text-fg-secondary italic">"{c.snippet}"</div>
                </>
              );
              const key = `${c.meetingId}-${c.startMs}-${idx}`;
              return href ? (
                <Link
                  key={key}
                  href={href}
                  className="block rounded bg-surface px-2 py-1 text-xs transition-colors hover:bg-bg-hover"
                >
                  {inner}
                </Link>
              ) : (
                <div key={key} className="rounded bg-surface px-2 py-1 text-xs">
                  {inner}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
