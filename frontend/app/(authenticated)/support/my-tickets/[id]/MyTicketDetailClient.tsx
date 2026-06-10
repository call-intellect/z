'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { supportApi } from '@/api/support.api';
import { useAuth } from '@/contexts/auth-context';
import { useMyTicket } from '@/hooks/useMyTicket';
import {
  isTicketResolvedStatus,
  type SupportMessage,
} from '@/domain/support';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

const REPLY_MAX = 5000;

/**
 * MyTicketDetailClient — детали обращения клиента. Все 4 UX-состояния.
 * Лента — только видимые (external) сообщения; автор — «Вы» (свои) или
 * «Поддержка» (остальные). Ответ + CSAT-оценка (после закрытия).
 */
export function MyTicketDetailClient({ ticketId }: { ticketId: string }) {
  const { user } = useAuth();
  const { data, error, isLoading, mutate } = useMyTicket(ticketId);

  if (error) return <ErrorView error={error} />;
  if (isLoading && !data) return <DetailSkeleton />;
  if (!data) return <ErrorView error={null} />;

  const resolved = isTicketResolvedStatus(data.status);

  return (
    <div>
      <Link
        href="/support/my-tickets"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fg-tertiary hover:text-fg-primary"
      >
        <ArrowLeft size={14} /> К списку обращений
      </Link>

      <header className="mb-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-fg-tertiary">
            {data.ticketNumber}
          </span>
          {data.status && <Badge variant="secondary">{data.status}</Badge>}
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg-primary">
          {data.subject}
        </h1>
      </header>

      <section aria-label="Переписка" className="flex flex-col gap-3">
        {data.messages.length === 0 ? (
          <p className="text-sm text-fg-tertiary">Сообщений пока нет.</p>
        ) : (
          data.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={m.authorId === user?.id}
            />
          ))
        )}
      </section>

      <ReplyBox ticketId={ticketId} onSent={() => void mutate()} />

      {resolved && (
        <RatingBox ticketId={ticketId} onRated={() => void mutate()} />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
}: {
  message: SupportMessage;
  isMine: boolean;
}) {
  const author = isMine ? 'Вы' : 'Поддержка';
  return (
    <div
      className={cn(
        'max-w-[85%] rounded-lg border px-4 py-3',
        isMine
          ? 'self-end border-accent-border bg-accent-muted'
          : 'self-start border-border-subtle bg-bg-card',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-fg-tertiary">
        <span className="font-medium text-fg-secondary">{author}</span>
        <span>{formatDateTime(message.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-fg-primary">
        {message.content}
      </p>
    </div>
  );
}

function ReplyBox({
  ticketId,
  onSent,
}: {
  ticketId: string;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = text.trim();
  const over = text.length > REPLY_MAX;
  const canSubmit = !submitting && trimmed.length > 0 && !over;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      try {
        await supportApi.addMyMessage(ticketId, { message: trimmed });
        setText('');
        toast.success('Сообщение отправлено');
        onSent();
      } catch (err) {
        toast.error(
          humanizeApiError(err, 'Не удалось отправить.'),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, onSent, ticketId, trimmed],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 rounded-lg border border-border-subtle bg-bg-card p-4"
    >
      <label htmlFor="support-reply" className="sr-only">
        Ваш ответ
      </label>
      <Textarea
        id="support-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={REPLY_MAX}
        placeholder="Напишите сообщение поддержке"
        disabled={submitting}
        className="resize-y"
      />
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={over ? 'text-danger' : 'text-fg-tertiary'}>
          {text.length} / {REPLY_MAX}
        </span>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? 'Отправляем…' : 'Отправить'}
        </Button>
      </div>
    </form>
  );
}

function RatingBox({
  ticketId,
  onRated,
}: {
  ticketId: string;
  onRated: () => void;
}) {
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (score < 1 || submitting) return;
    setSubmitting(true);
    try {
      await supportApi.rateMyTicket(ticketId, {
        score,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setDone(true);
      toast.success('Спасибо за оценку!');
      onRated();
    } catch (err) {
      toast.error(
        humanizeApiError(err, 'Не удалось сохранить оценку.'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [comment, onRated, score, submitting, ticketId]);

  if (done) {
    return (
      <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        Оценка сохранена. Спасибо, что помогаете нам стать лучше.
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-lg border border-border-subtle bg-bg-card p-4">
      <h2 className="text-sm font-medium text-fg-primary">
        Оцените работу поддержки
      </h2>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= (hover || score);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              className="rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Оценка ${n} из 5`}
              aria-pressed={n === score}
            >
              <Star
                size={24}
                className={cn(
                  active ? 'text-warning' : 'text-fg-tertiary/40',
                )}
                fill={active ? 'currentColor' : 'none'}
              />
            </button>
          );
        })}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Комментарий (необязательно)"
        disabled={submitting}
        className="mt-3 resize-y"
        aria-label="Комментарий к оценке"
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={score < 1 || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Сохраняем…' : 'Отправить оценку'}
        </Button>
      </div>
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : 'Не удалось загрузить обращение.';
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-6 w-40 animate-pulse rounded bg-bg-overlay/70" />
      <div className="h-20 w-full animate-pulse rounded-lg bg-bg-overlay/70" />
      <div className="h-20 w-full animate-pulse rounded-lg bg-bg-overlay/70" />
    </div>
  );
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
