"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { externalChatApi } from "@/api/external-chat.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  formatExternalMessageTime,
  lastExternalSeq,
  mergeExternalMessages,
  toExternalMessage,
  type ExternalMessage,
} from "@/domain/external-chat";
import { Button } from "@/ui/components/shared/Button";
import { Skeleton } from "@/ui/components/shared/Skeleton";

type Props = { token: string };

type AccessStatus =
  | { state: "loading" }
  | { state: "error"; title: string; message: string; retryable: boolean }
  | { state: "ready"; conversationId: string };

const POLL_INTERVAL_MS = 7000;

const ACCESS_ERROR_TEXT: Record<string, { title: string; message: string }> = {
  ACCESS_LINK_INVALID: {
    title: "Ссылка недействительна",
    message:
      "Эта ссылка на переписку не распознана. Попросите вашего менеджера прислать новую.",
  },
  ACCESS_LINK_REVOKED: {
    title: "Ссылка отозвана",
    message: "Доступ по этой ссылке закрыт. Запросите новую ссылку у менеджера.",
  },
  ACCESS_LINK_EXPIRED: {
    title: "Срок ссылки истёк",
    message:
      "Ссылка на переписку больше не действует. Попросите менеджера прислать свежую.",
  },
  EXTERNAL_CHAT_DISABLED: {
    title: "Переписка временно недоступна",
    message: "Внешний чат с клиентами сейчас выключен. Попробуйте позже.",
  },
};

function resolveAccessError(error: unknown): {
  title: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ApiError) {
    const known = ACCESS_ERROR_TEXT[error.code];
    if (known) return { ...known, retryable: false };
  }
  return {
    title: "Не удалось открыть переписку",
    message: humanizeApiError(error, "Попробуйте обновить страницу."),
    retryable: true,
  };
}

export function ExternalChatClient({ token }: Props) {
  const [access, setAccess] = useState<AccessStatus>({ state: "loading" });
  const [messages, setMessages] = useState<ExternalMessage[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);

  const messagesRef = useRef<ExternalMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  messagesRef.current = messages;

  const runAccess = useCallback(async () => {
    setAccess({ state: "loading" });
    try {
      const res = await externalChatApi.access(token);
      setAccess({ state: "ready", conversationId: res.conversationId });
    } catch (error) {
      const resolved = resolveAccessError(error);
      setAccess({ state: "error", ...resolved });
    }
  }, [token]);

  useEffect(() => {
    void runAccess();
  }, [runAccess]);

  const conversationId =
    access.state === "ready" ? access.conversationId : null;

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const sinceSeq = lastExternalSeq(messagesRef.current);
      const res = await externalChatApi.listMessages(
        conversationId,
        sinceSeq,
      );
      const incoming = res.items.map(toExternalMessage);
      if (incoming.length > 0) {
        setMessages((prev) => mergeExternalMessages(prev, incoming));
      }
      setFeedError(null);
    } catch (error) {
      setFeedError(humanizeApiError(error, "Не удалось обновить переписку."));
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    void loadMessages();
    const timer = setInterval(() => void loadMessages(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversationId, loadMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || !conversationId || sending) return;
    setSending(true);
    const clientMessageId = crypto.randomUUID();
    try {
      const res = await externalChatApi.sendMessage(conversationId, {
        content,
        clientMessageId,
      });
      setDraft("");
      const before = new Set(messagesRef.current.map((m) => m.id));
      const list = await externalChatApi.listMessages(
        conversationId,
        lastExternalSeq(messagesRef.current),
      );
      const incoming = list.items.map(toExternalMessage);
      setMessages((prev) => mergeExternalMessages(prev, incoming));
      if (!selfUserId) {
        const mine =
          incoming.find((m) => m.id === res.messageId) ??
          incoming.find((m) => !before.has(m.id) && m.authorType === "human");
        if (mine) setSelfUserId(mine.authorUserId);
      }
      setFeedError(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === "EXTERNAL_RATE_LIMITED") {
        setFeedError("Слишком часто. Подождите немного и попробуйте снова.");
      } else {
        setFeedError(humanizeApiError(error, "Не удалось отправить сообщение."));
      }
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, sending, selfUserId]);

  if (access.state === "loading") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bg-subtle p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  if (access.state === "error") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bg-subtle p-6">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border-subtle bg-bg-elevated p-6 text-center">
          <h1 className="text-lg font-semibold text-fg-primary">
            {access.title}
          </h1>
          <p className="text-sm text-fg-secondary">{access.message}</p>
          {access.retryable ? (
            <Button onClick={() => void runAccess()}>Попробовать снова</Button>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col bg-bg-base">
      <ExternalChatHeader
        token={token}
        conversationId={access.conversationId}
      />

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-fg-tertiary">
              Здесь появится ваша переписка. Напишите первое сообщение ниже.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} selfUserId={selfUserId} />
          ))
        )}
        {feedError ? (
          <p className="text-center text-xs text-danger">{feedError}</p>
        ) : null}
      </div>

      <Composer
        value={draft}
        sending={sending}
        onChange={setDraft}
        onSend={() => void handleSend()}
      />
    </main>
  );
}

function isOutgoing(
  message: ExternalMessage,
  selfUserId: string | null,
): boolean {
  if (message.authorType !== "human") return false;
  if (!selfUserId) return false;
  return message.authorUserId === selfUserId;
}

function authorLabel(message: ExternalMessage): string {
  if (message.authorType === "clone") return "Ассистент";
  if (message.authorType === "system") return "Система";
  return "Команда";
}

function MessageBubble({
  message,
  selfUserId,
}: {
  message: ExternalMessage;
  selfUserId: string | null;
}) {
  const outgoing = isOutgoing(message, selfUserId);
  return (
    <div className={outgoing ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          outgoing
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-accent-fg"
            : "max-w-[80%] rounded-2xl rounded-bl-sm border border-border-subtle bg-bg-elevated px-3.5 py-2 text-fg-primary"
        }
      >
        {!outgoing ? (
          <p className="mb-0.5 text-xs font-medium text-fg-tertiary">
            {authorLabel(message)}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content}
        </p>
        <p
          className={
            outgoing
              ? "mt-1 text-right text-[11px] text-accent-fg/70"
              : "mt-1 text-right text-[11px] text-fg-tertiary"
          }
        >
          {formatExternalMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function Composer({
  value,
  sending,
  onChange,
  onSend,
}: {
  value: string;
  sending: boolean;
  onChange: (next: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="sticky bottom-0 border-t border-border-subtle bg-bg-base px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder="Напишите сообщение…"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-tertiary focus:border-border-strong focus:outline-none"
        />
        <Button
          onClick={onSend}
          loading={sending}
          disabled={value.trim().length === 0}
          className="h-[44px] shrink-0"
        >
          Отправить
        </Button>
      </div>
    </div>
  );
}

type RegisterStage = "idle" | "code" | "done";
type ContactKind = "email" | "phone";

function ExternalChatHeader({
  token,
  conversationId,
}: {
  token: string;
  conversationId: string;
}) {
  const [registerOpen, setRegisterOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const handleReport = useCallback(async () => {
    if (reporting || reported) return;
    setReporting(true);
    try {
      await externalChatApi.report(conversationId);
      setReported(true);
    } finally {
      setReporting(false);
    }
  }, [conversationId, reporting, reported]);

  return (
    <header className="border-b border-border-subtle bg-bg-base">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h1 className="text-base font-semibold text-fg-primary">Переписка</h1>
        <button
          type="button"
          onClick={() => void handleReport()}
          disabled={reporting || reported}
          className="text-xs font-medium text-fg-tertiary underline-offset-2 hover:text-fg-secondary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {reported ? "Жалоба отправлена" : "Пожаловаться"}
        </button>
      </div>
      <RegisterBanner
        token={token}
        open={registerOpen}
        onToggle={() => setRegisterOpen((v) => !v)}
      />
    </header>
  );
}

function RegisterBanner({
  token,
  open,
  onToggle,
}: {
  token: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [stage, setStage] = useState<RegisterStage>("idle");
  const [contactKind, setContactKind] = useState<ContactKind>("email");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contactPayload = useCallback(() => {
    return contactKind === "email"
      ? { email: contact.trim() }
      : { phone: contact.trim() };
  }, [contactKind, contact]);

  const requestCode = useCallback(async () => {
    if (busy || contact.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await externalChatApi.requestRegisterCode(token, contactPayload());
      setStage("code");
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось отправить код."));
    } finally {
      setBusy(false);
    }
  }, [busy, contact, contactPayload, token]);

  const submitCode = useCallback(async () => {
    if (busy || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      await externalChatApi.register(token, contactPayload(), code);
      setStage("done");
    } catch (e) {
      setError(humanizeApiError(e, "Неверный код. Попробуйте ещё раз."));
    } finally {
      setBusy(false);
    }
  }, [busy, code, contactPayload, token]);

  if (stage === "done") {
    return (
      <div className="bg-chip-success-bg px-4 py-2 text-xs text-chip-success-fg">
        Контакт подтверждён — мы сохраним переписку и пришлём уведомление о новых
        сообщениях.
      </div>
    );
  }

  return (
    <div className="bg-bg-subtle px-4 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left text-xs text-fg-secondary"
      >
        <span>
          Оставьте email или телефон, чтобы вернуться к переписке и получать
          уведомления.
        </span>
        <span className="ml-2 shrink-0 font-medium text-accent">
          {open ? "Скрыть" : "Оставить"}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-2">
          {stage === "idle" ? (
            <>
              <div className="flex gap-1">
                <ContactTab
                  active={contactKind === "email"}
                  onClick={() => setContactKind("email")}
                >
                  Email
                </ContactTab>
                <ContactTab
                  active={contactKind === "phone"}
                  onClick={() => setContactKind("phone")}
                >
                  Телефон
                </ContactTab>
              </div>
              <div className="flex gap-2">
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  type={contactKind === "email" ? "email" : "tel"}
                  inputMode={contactKind === "email" ? "email" : "tel"}
                  placeholder={
                    contactKind === "email"
                      ? "you@example.com"
                      : "+7 900 000-00-00"
                  }
                  className="flex-1 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary focus:border-border-strong focus:outline-none"
                />
                <Button
                  size="sm"
                  loading={busy}
                  disabled={contact.trim().length === 0}
                  onClick={() => void requestCode()}
                >
                  Прислать код
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/gu, "").slice(0, 6))
                }
                inputMode="numeric"
                placeholder="Код из 6 цифр"
                className="flex-1 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary focus:border-border-strong focus:outline-none"
              />
              <Button
                size="sm"
                loading={busy}
                disabled={!/^\d{6}$/.test(code)}
                onClick={() => void submitCode()}
              >
                Подтвердить
              </Button>
            </div>
          )}
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ContactTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg"
          : "rounded-md bg-bg-elevated px-3 py-1 text-xs font-medium text-fg-secondary hover:bg-bg-overlay"
      }
    >
      {children}
    </button>
  );
}
