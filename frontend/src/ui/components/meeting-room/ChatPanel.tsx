'use client';

/**
 * Правая панель in-meeting чата с persist через backend.
 *
 * - Подгружает историю на mount (`GET /meetings/:id/room-messages`).
 * - Live-сообщения — через LiveKit DataChannel (`useChat()`).
 * - При отправке параллельно: LiveKit `send()` + наш `POST` (идемпотентный
 *   по `clientMessageId`).
 * - Дедуп: `clientMessageId` пробрасывается в `attributes` LiveKit-сообщения.
 *
 * История чата сохраняется в `MeetingRoomMessage` и видна:
 * - опоздавшим участникам (через GET history при join);
 * - на странице результата (6-й таб «Чат»);
 * - на public share-странице (если `allowChat=true`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat, useLocalParticipant } from '@livekit/components-react';
import type { ReceivedChatMessage } from '@livekit/components-core';
import { nanoid } from 'nanoid';

import { roomMessagesApi } from '@/api/room-messages.api';
import { ApiError } from '@/api/api-error';
import {
  roomMessageFromApi,
  type RoomMessageDomain,
} from '@/domain/room-message';
import { t } from '@/lib/i18n';
import { toast } from '@/ui/shadcn/toast';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

const MAX_CONTENT = 2000;
const COUNTER_THRESHOLD = 1800;
const ATTR_CLIENT_MESSAGE_ID = 'clientMessageId';

type Props = {
  open: boolean;
  onClose: () => void;
  meetingId: string;
};

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractClientId(msg: ReceivedChatMessage): string | null {
  const attrs = msg.attributes;
  if (attrs && typeof attrs[ATTR_CLIENT_MESSAGE_ID] === 'string') {
    return attrs[ATTR_CLIENT_MESSAGE_ID];
  }
  return null;
}

export function ChatPanel({ open, onClose, meetingId }: Props) {
  const { localParticipant } = useLocalParticipant();
  const { send, chatMessages, isSending } = useChat();

  // История с backend (загружается на mount).
  const [historyMessages, setHistoryMessages] = useState<RoomMessageDomain[]>(
    [],
  );
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /** Время join'а — отделяет историю от live (для divider'а). */
  const joinedAtRef = useRef<Date | null>(null);

  // Live-сообщения (свои optimistic + чужие из DataChannel).
  const [liveMessages, setLiveMessages] = useState<RoomMessageDomain[]>([]);

  // Известные clientMessageId — для дедупа.
  const knownClientIdsRef = useRef<Set<string>>(new Set());

  // Текст в input.
  const [draft, setDraft] = useState('');

  // Скролл-контейнер.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // 1. Загрузка истории при mount.
  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    joinedAtRef.current = new Date();
    roomMessagesApi
      .history(meetingId)
      .then((res) => {
        if (cancelled) return;
        const domain = res.map((m) => roomMessageFromApi(m, { fromHistory: true }));
        const ids = knownClientIdsRef.current;
        domain.forEach((m) => ids.add(m.clientMessageId));
        setHistoryMessages(domain);
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // История не критична — пустой список + флаг.
        setHistoryMessages([]);
        setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // 2. Подписка на новые DataChannel-сообщения.
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const localIdentity = localParticipant?.identity;
    setLiveMessages((prev) => {
      const known = knownClientIdsRef.current;
      let next = prev;
      for (const msg of chatMessages) {
        const fromIdentity = msg.from?.identity ?? '';
        // Свои сообщения пропускаем — добавляем optimistic в onSend.
        if (localIdentity && fromIdentity === localIdentity) continue;

        const clientId = extractClientId(msg);
        // Если без clientId — синтезируем (legacy-fallback).
        const id = clientId ?? `lk-${msg.id}`;
        if (known.has(id)) continue;
        known.add(id);

        const authorName =
          (msg.from?.name && msg.from.name.trim()) ||
          msg.from?.identity ||
          'Гость';
        const domainMsg: RoomMessageDomain = {
          id,
          meetingId,
          authorName,
          authorIdentity: fromIdentity,
          content: msg.message,
          clientMessageId: id,
          sentAt: new Date(msg.timestamp),
        };
        if (next === prev) next = [...prev];
        next.push(domainMsg);
      }
      return next;
    });
  }, [chatMessages, localParticipant, meetingId]);

  // 3. Auto-scroll: вниз только если юзер уже внизу.
  const allMessages = useMemo(
    () => [...historyMessages, ...liveMessages],
    [historyMessages, liveMessages],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [allMessages.length]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 60;
  }, []);

  // 4. Отправка.
  const onSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    if (text.length > MAX_CONTENT) {
      toast.error(`Сообщение длиннее ${MAX_CONTENT} символов.`);
      return;
    }

    const clientMessageId = nanoid(20);
    const localIdentity = localParticipant?.identity ?? '';
    const localName =
      (localParticipant?.name && localParticipant.name.trim()) ||
      localIdentity ||
      'Я';

    const optimistic: RoomMessageDomain = {
      id: `local-${clientMessageId}`,
      meetingId,
      authorName: localName,
      authorIdentity: localIdentity,
      content: text,
      clientMessageId,
      sentAt: new Date(),
    };

    knownClientIdsRef.current.add(clientMessageId);
    setLiveMessages((prev) => [...prev, optimistic]);
    setDraft('');
    stickToBottomRef.current = true;

    // LiveKit live-broadcast (получатели дедупят по `attributes.clientMessageId`).
    const livekitSend = send(text, {
      attributes: { [ATTR_CLIENT_MESSAGE_ID]: clientMessageId },
    }).catch(() => {
      // Не критично — остальные участники могут не увидеть, но история сохранится.
    });

    // Persist.
    const persist = roomMessagesApi
      .send(meetingId, { clientMessageId, content: text })
      .then((apiMsg) => {
        // Подмена локального id на серверный.
        setLiveMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...m, id: apiMsg.id, sentAt: new Date(apiMsg.sentAt) }
              : m,
          ),
        );
      })
      .catch((e) => {
        const message =
          e instanceof ApiError
            ? e.message
            : 'Сообщение не сохранено в истории, но участники его получили.';
        toast.error(message);
        setLiveMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...m, notPersisted: true }
              : m,
          ),
        );
      });

    await Promise.allSettled([livekitSend, persist]);
  }, [draft, isSending, localParticipant, meetingId, send]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onSubmit();
      }
    },
    [onSubmit],
  );

  if (!open) return null;

  // Найдём индекс первого live-сообщения для divider'а.
  const liveStartIdx = historyMessages.length;
  const showDivider = historyMessages.length > 0;

  return (
    <aside
      className="flex h-full w-80 flex-col border-l border-border-subtle bg-bg-card text-fg-primary"
      data-testid="chat-panel"
    >
      <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-primary">
          {t('room.controls.chat')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="grid h-7 w-7 place-items-center rounded text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
        >
          ×
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-3"
      >
        {!historyLoaded && (
          <div className="px-2 py-4 text-center text-xs text-fg-tertiary">
            Загрузка истории…
          </div>
        )}

        {historyLoaded && allMessages.length === 0 && (
          <div className="px-2 py-8 text-center text-xs text-fg-tertiary">
            Чат пуст. Напишите первое сообщение.
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {allMessages.map((m, i) => {
            const isOwn =
              !!localParticipant &&
              !!m.authorIdentity &&
              m.authorIdentity === localParticipant.identity;
            const showDividerHere = showDivider && i === liveStartIdx;
            return (
              <li key={m.id || `${m.clientMessageId}-${i}`}>
                {showDividerHere && (
                  <div className="my-3 flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-fg-tertiary">
                    <span className="h-px flex-1 bg-border-subtle" />
                    <span>До твоего присоединения</span>
                    <span className="h-px flex-1 bg-border-subtle" />
                  </div>
                )}
                <ChatBubble message={m} isOwn={isOwn} />
              </li>
            );
          })}
        </ul>
      </div>

      <form
        className="flex flex-col gap-1.5 border-t border-border-subtle p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_CONTENT))}
          onKeyDown={onKeyDown}
          placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)"
          rows={2}
          className="min-h-[60px] resize-none text-sm"
          maxLength={MAX_CONTENT}
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'font-mono text-[10px]',
              draft.length > COUNTER_THRESHOLD
                ? 'text-warning'
                : 'text-fg-tertiary',
              draft.length > COUNTER_THRESHOLD ? 'visible' : 'invisible',
            )}
          >
            {draft.length} / {MAX_CONTENT}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={!draft.trim() || isSending}
          >
            Отправить
          </Button>
        </div>
      </form>
    </aside>
  );
}

function ChatBubble({
  message,
  isOwn,
}: {
  message: RoomMessageDomain;
  isOwn: boolean;
}) {
  return (
    <div className={cn('flex flex-col', isOwn ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-md px-3 py-2 text-sm leading-snug',
          isOwn
            ? 'bg-accent-muted text-accent-fg'
            : 'border border-border-subtle bg-bg-overlay text-fg-primary',
        )}
      >
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-fg-secondary">
            {isOwn ? 'Вы' : message.authorName}
          </span>
          <span className="font-mono text-[10px] text-fg-tertiary">
            {fmtTime(message.sentAt)}
          </span>
          {message.notPersisted && (
            <span
              className="font-mono text-[10px] text-warning"
              title="Сообщение не сохранилось в истории"
            >
              ⚠
            </span>
          )}
        </div>
        <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}
