'use client';

/**
 * IssueComments — multi-user чат-комментарии задачи (T8, 2026-05-24).
 *
 * Сводный поток:
 *   - REST GET `/issues/:id/comments` (через `useIssueComments`) для initial-загрузки.
 *   - WebSocket `/ws/tracker`:
 *       · `comment.*` → автоинвалидация SWR-кэша через `useTrackerLiveRefresh`
 *         (live-обновление без polling'а).
 *       · presence/typing → `useIssueChatPresence` (онлайн-список и
 *         индикатор «печатает...»).
 *   - @-mention autocomplete через `MentionAutocompletePopup`. После выбора
 *     в текст вставляется `@<handle>` (handle = email-local-part или userId);
 *     backend `CommentsService.extractMentionTokens` парсит эти токены и
 *     резолвит в IssueMention + Notification(issue.mention).
 *
 * NB: REST-эндпоинт для создания comment'а остаётся — WS только доставляет
 * созданные comments обратно всем подписанным клиентам через
 * `comment.created` → SWR mutate.
 */

import { Loader2, Send } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { commentsApi } from '@/api/tracker/comments.api';
import {
  memberDisplayName,
  memberHandle,
  type Comment,
  type ProjectMember,
} from '@/domain/tracker';
import { useIssueChatPresence } from '@/hooks/tracker/useIssueChatPresence';
import { useIssueComments } from '@/hooks/tracker/useIssueComments';
import { useProjectMembers } from '@/hooks/tracker/useProject';
import { useTrackerLiveRefresh } from '@/hooks/tracker/useTrackerLiveRefresh';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

import { AssigneeAvatar } from './AssigneeAvatar';
import { MentionAutocompletePopup } from './MentionAutocompletePopup';

export interface IssueCommentsProps {
  orgId: string;
  issueId: string;
  /**
   * T8: нужен для подгрузки участников проекта (для @-mention autocomplete'а).
   * Если не передан — autocomplete деградирует (mention'ы можно ввести вручную,
   * но без подсказок).
   */
  projectId?: string;
}

interface MentionState {
  open: boolean;
  query: string;
  /** Индекс символа `@` в textarea — для замены при выборе. */
  anchor: number;
}

export function IssueComments({ orgId, issueId, projectId }: IssueCommentsProps) {
  const { comments, isLoading, error, mutate } = useIssueComments(orgId, issueId);
  const { members } = useProjectMembers(orgId, projectId ?? null);

  // T8: live-обновление comments через WS `comment.*` events (мутирует
  // SWR-кэш 'tracker.issue.comments'). Также join'нем room задачи, чтобы
  // получать события issue.*.
  useTrackerLiveRefresh(orgId, { issueId }, true);

  // T8: presence/typing.
  const { onlineUsers, typingUsers, sendTyping } = useIssueChatPresence(
    orgId,
    issueId,
  );

  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<MentionState>({
    open: false,
    query: '',
    anchor: -1,
  });

  // ── @-mention detection ─────────────────────────────────────────────
  const updateMentionState = useCallback(
    (nextValue: string, caret: number): void => {
      // Найти последний @ перед каретой; если за ним нет пробела/конца —
      // значит мы в режиме ввода mention'а.
      const before = nextValue.slice(0, caret);
      const atIdx = before.lastIndexOf('@');
      if (atIdx < 0) {
        setMention({ open: false, query: '', anchor: -1 });
        return;
      }
      // @ должен быть в начале строки или после пробела (иначе это email-подобный
      // текст). Иначе закрываем popup.
      const charBefore = atIdx === 0 ? ' ' : before[atIdx - 1] ?? ' ';
      if (!/\s/.test(charBefore)) {
        setMention({ open: false, query: '', anchor: -1 });
        return;
      }
      const query = before.slice(atIdx + 1);
      // Если в query есть пробел — пользователь уже закончил mention.
      if (/\s/.test(query)) {
        setMention({ open: false, query: '', anchor: -1 });
        return;
      }
      setMention({ open: true, query, anchor: atIdx });
    },
    [],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>): void => {
      const next = e.target.value;
      setValue(next);
      const caret = e.target.selectionStart ?? next.length;
      updateMentionState(next, caret);
      // Сообщить серверу, что юзер печатает (throttled внутри хука).
      sendTyping(next.length > 0);
    },
    [sendTyping, updateMentionState],
  );

  const handleSelectMention = useCallback(
    (member: ProjectMember): void => {
      if (mention.anchor < 0) return;
      const handle = memberHandle(member);
      const before = value.slice(0, mention.anchor);
      const afterStart = mention.anchor + 1 + mention.query.length;
      const after = value.slice(afterStart);
      const inserted = `@${handle}`;
      const next = `${before}${inserted} ${after}`;
      setValue(next);
      setMention({ open: false, query: '', anchor: -1 });
      // Восстановим каретку сразу после вставки.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const pos = before.length + inserted.length + 1;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    },
    [mention.anchor, mention.query.length, value],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Escape' && mention.open) {
        setMention({ open: false, query: '', anchor: -1 });
        e.preventDefault();
      }
    },
    [mention.open],
  );

  // ── Submit ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      await commentsApi.create(orgId, issueId, { content });
      setValue('');
      setMention({ open: false, query: '', anchor: -1 });
      sendTyping(false);
      // SWR mutate срабатывает автоматически по `comment.created` через
      // useTrackerLiveRefresh. Дублирующий вызов оставляем для надёжности —
      // если WS отвалился, REST-fetch всё равно обновит список.
      await mutate();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  }, [issueId, mutate, orgId, sendTyping, sending, value]);

  // ── Помощники для UI ────────────────────────────────────────────────
  const onlineSummary = useMemo<string | null>(() => {
    if (onlineUsers.length === 0) return null;
    if (onlineUsers.length === 1) return `${onlineUsers[0]!.displayName} онлайн`;
    if (onlineUsers.length === 2) {
      return `${onlineUsers[0]!.displayName} и ${onlineUsers[1]!.displayName} онлайн`;
    }
    return `${onlineUsers.length} человек онлайн`;
  }, [onlineUsers]);

  const typingSummary = useMemo<string | null>(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0]!.displayName} печатает…`;
    if (typingUsers.length === 2) {
      return `${typingUsers[0]!.displayName} и ${typingUsers[1]!.displayName} печатают…`;
    }
    return `${typingUsers.length} человек печатают…`;
  }, [typingUsers]);

  // Карта userId → displayName для рендера CommentItem.
  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.userId, memberDisplayName(m));
    return map;
  }, [members]);

  return (
    <div className="flex flex-col gap-3">
      {/* Presence widget */}
      {onlineSummary ? (
        <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary">
          <span
            className="inline-block h-2 w-2 rounded-full bg-success"
            aria-hidden
          />
          <span>{onlineSummary}</span>
          {onlineUsers.length > 1 ? (
            <span className="ml-auto flex -space-x-2">
              {onlineUsers.slice(0, 5).map((u) => (
                <AssigneeAvatar key={u.userId} userId={u.userId} size={20} />
              ))}
              {onlineUsers.length > 5 ? (
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full border border-border-subtle bg-bg-overlay px-1 text-[10px] text-fg-tertiary">
                  +{onlineUsers.length - 5}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="text-sm text-danger">
          Не удалось загрузить комментарии.
        </div>
      ) : comments.length === 0 ? (
        <div className="text-sm text-fg-tertiary">Комментариев пока нет.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              authorDisplayName={userNameMap.get(c.authorId) ?? null}
            />
          ))}
        </ul>
      )}

      <div className="relative flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            sendTyping(false);
            // Чуть задержим закрытие popup'а, чтобы успел сработать onClick
            // по элементу popup'а (blur пришёл бы раньше).
            setTimeout(() => setMention((m) => ({ ...m, open: false })), 120);
          }}
          placeholder="Добавить комментарий… (@ — упомянуть участника)"
          rows={3}
          disabled={sending}
          className="resize-none"
        />
        {mention.open && projectId ? (
          <div className="absolute left-3 top-full">
            <MentionAutocompletePopup
              members={members}
              query={mention.query}
              onSelect={handleSelectMention}
              onClose={() =>
                setMention({ open: false, query: '', anchor: -1 })
              }
            />
          </div>
        ) : null}
        {typingSummary ? (
          <div className="text-[11px] text-fg-tertiary">{typingSummary}</div>
        ) : null}
        {sendErr && <div className="text-xs text-danger">{sendErr}</div>}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={sending || value.trim().length === 0}
            className="gap-2"
          >
            {sending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  authorDisplayName,
}: {
  comment: Comment;
  authorDisplayName: string | null;
}) {
  const name = authorDisplayName ?? 'Участник';
  return (
    <li className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2">
      <AssigneeAvatar userId={comment.authorId} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-fg-primary">{name}</span>
          <span className="text-[10px] text-fg-tertiary">
            {comment.createdAt.toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {comment.isEdited && ' · изменён'}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-primary">
          {comment.isDeleted ? (
            <em className="text-fg-tertiary">Комментарий удалён</em>
          ) : (
            comment.content
          )}
        </p>
      </div>
    </li>
  );
}
