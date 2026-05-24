'use client';

/**
 * IssueComments — список комментариев + форма добавления.
 */

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { useIssueComments } from '@/hooks/tracker/useIssueComments';
import { commentsApi } from '@/api/tracker/comments.api';
import type { Comment } from '@/domain/tracker';
import { AssigneeAvatar } from './AssigneeAvatar';

export function IssueComments({
  orgId,
  issueId,
}: {
  orgId: string;
  issueId: string;
}) {
  const { comments, isLoading, error, mutate } = useIssueComments(orgId, issueId);
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const handleSend = async () => {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      await commentsApi.create(orgId, issueId, { content });
      setValue('');
      await mutate();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
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
            <CommentItem key={c.id} comment={c} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Добавить комментарий…"
          rows={3}
          disabled={sending}
          className="resize-none"
        />
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

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2">
      <AssigneeAvatar userId={comment.authorId} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-fg-primary">
            {comment.authorId.slice(0, 8)}
          </span>
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
