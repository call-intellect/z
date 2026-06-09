'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { supportApi } from '@/api/support.api';
import { useDeskTicket } from '@/hooks/useDeskTicket';
import { useDeskMeta } from '@/hooks/useDeskMeta';
import { useSupportStatus } from '@/hooks/useSupportStatus';
import type { DeskMessage, SupportMeta } from '@/domain/support';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

const TEXT_MAX = 5000;

/**
 * DeskTicketDetailClient — рабочий экран тикета сотрудника. Все 4 UX-состояния.
 * Гейт по isAgent (не падаем на 403). Все действия мутируют SWR-кэш.
 */
export function DeskTicketDetailClient({ ticketId }: { ticketId: string }) {
  const { isAgent, isLoading: statusLoading } = useSupportStatus();
  const { data, error, isLoading, mutate } = useDeskTicket(ticketId, isAgent);
  const { data: meta } = useDeskMeta(isAgent);

  if (statusLoading) return <DetailSkeleton />;
  if (!isAgent) return <NotAgent />;
  if (error) return <ErrorView error={error} />;
  if (isLoading && !data) return <DetailSkeleton />;
  if (!data) return <ErrorView error={null} />;

  const refresh = () => void mutate();

  return (
    <div>
      <Link
        href="/support/desk"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fg-tertiary hover:text-fg-primary"
      >
        <ArrowLeft size={14} /> К очереди
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-fg-tertiary">
            {data.ticketNumber}
          </span>
          {data.status && <Badge variant="secondary">{data.status}</Badge>}
          {data.slaBreachedAt && <Badge variant="danger">SLA нарушен</Badge>}
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-fg-primary">
          {data.subject}
        </h1>
        {data.customerContact && (
          <p className="mt-1 text-sm text-fg-secondary">
            Клиент: {data.customerContact}
          </p>
        )}
      </header>

      {/* Управление: назначение + статус */}
      <DeskControls
        ticketId={ticketId}
        meta={meta}
        currentStatusName={data.status}
        assigneeUserIds={data.assigneeUserIds}
        onChanged={refresh}
      />

      {/* Лента — internal + external */}
      <section aria-label="Переписка" className="mt-5 flex flex-col gap-3">
        {data.messages.length === 0 ? (
          <p className="text-sm text-fg-tertiary">Сообщений пока нет.</p>
        ) : (
          data.messages.map((m) => <DeskMessageBubble key={m.id} message={m} />)
        )}
      </section>

      {/* Ответ клиенту */}
      <ComposeBox
        title="Ответ клиенту"
        placeholder="Ответ будет виден клиенту"
        submitLabel="Ответить клиенту"
        onSubmit={(text) => supportApi.deskReply(ticketId, { message: text })}
        onSent={refresh}
        accent
      />

      {/* Внутренняя заметка */}
      <ComposeBox
        title="Внутренняя заметка"
        placeholder="Заметка видна только команде поддержки"
        submitLabel="Добавить заметку"
        onSubmit={(text) => supportApi.deskNote(ticketId, { message: text })}
        onSent={refresh}
      />
    </div>
  );
}

function DeskControls({
  ticketId,
  meta,
  currentStatusName,
  assigneeUserIds,
  onChanged,
}: {
  ticketId: string;
  meta: SupportMeta | undefined;
  currentStatusName: string | null;
  assigneeUserIds: string[];
  onChanged: () => void;
}) {
  const [assignBusy, setAssignBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Текущий статус по названию (бэк отдаёт name, не stateId).
  const currentState = meta?.states.find((s) => s.name === currentStatusName);
  const currentAssignee =
    assigneeUserIds.length > 0 ? assigneeUserIds[0] : undefined;

  const handleAssign = useCallback(
    async (userId: string) => {
      setAssignBusy(true);
      try {
        await supportApi.deskAssign(ticketId, { userId });
        toast.success('Исполнитель назначен');
        onChanged();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Не удалось назначить.',
        );
      } finally {
        setAssignBusy(false);
      }
    },
    [onChanged, ticketId],
  );

  const handleTransition = useCallback(
    async (stateId: string) => {
      setStatusBusy(true);
      try {
        await supportApi.deskTransition(ticketId, { stateId });
        toast.success('Статус изменён');
        onChanged();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Не удалось сменить статус.',
        );
      } finally {
        setStatusBusy(false);
      }
    },
    [onChanged, ticketId],
  );

  return (
    <div className="grid gap-3 rounded-lg border border-border-subtle bg-bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-fg-secondary">
          Исполнитель
        </label>
        <Select
          value={currentAssignee}
          onValueChange={(v) => void handleAssign(v)}
          disabled={assignBusy || !meta || meta.agents.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Назначить сотрудника" />
          </SelectTrigger>
          <SelectContent>
            {meta?.agents.map((a) => (
              <SelectItem key={a.userId} value={a.userId}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-fg-secondary">
          Статус
        </label>
        <Select
          value={currentState?.id}
          onValueChange={(v) => void handleTransition(v)}
          disabled={statusBusy || !meta || meta.states.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Выбрать статус" />
          </SelectTrigger>
          <SelectContent>
            {meta?.states.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function DeskMessageBubble({ message }: { message: DeskMessage }) {
  const isInternal = message.access === 'internal';
  const authorLabel =
    message.authorType === 'clone'
      ? 'Клон (черновик)'
      : isInternal
        ? 'Заметка'
        : 'Поддержка / клиент';

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        isInternal
          ? 'border-warning/30 bg-warning/10'
          : 'border-border-subtle bg-bg-card',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-fg-tertiary">
        <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
          {authorLabel}
          {isInternal && (
            <Badge variant="warning" className="px-1.5 py-0">
              внутреннее
            </Badge>
          )}
        </span>
        <span>{formatDateTime(message.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-fg-primary">
        {message.content}
      </p>
    </div>
  );
}

function ComposeBox({
  title,
  placeholder,
  submitLabel,
  onSubmit,
  onSent,
  accent,
}: {
  title: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<unknown>;
  onSent: () => void;
  accent?: boolean;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = text.trim();
  const over = text.length > TEXT_MAX;
  const canSubmit = !submitting && trimmed.length > 0 && !over;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      try {
        await onSubmit(trimmed);
        setText('');
        toast.success('Готово');
        onSent();
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Не удалось отправить.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, onSent, onSubmit, trimmed],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'mt-4 rounded-lg border p-4',
        accent
          ? 'border-border-subtle bg-bg-card'
          : 'border-warning/30 bg-warning/5',
      )}
    >
      <h2 className="mb-2 text-sm font-medium text-fg-primary">{title}</h2>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={TEXT_MAX}
        placeholder={placeholder}
        disabled={submitting}
        className="resize-y"
        aria-label={title}
      />
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={over ? 'text-danger' : 'text-fg-tertiary'}>
          {text.length} / {TEXT_MAX}
        </span>
        <Button
          type="submit"
          size="sm"
          variant={accent ? 'default' : 'secondary'}
          disabled={!canSubmit}
        >
          {submitting ? 'Отправляем…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function NotAgent() {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card px-6 py-12 text-center text-sm text-fg-tertiary">
      Вы не сотрудник поддержки.
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? error.message : 'Не удалось загрузить тикет.';
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
