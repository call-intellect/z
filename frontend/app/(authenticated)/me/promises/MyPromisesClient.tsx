'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  promisesApi,
  type CommitmentApi,
  type CommitmentStatusApi,
} from '@/api/promises.api';
import { openQuestionFromApi, type OpenQuestion } from '@/domain/promises';
import { toast } from 'sonner';

/**
 * SBA β-8.2 + ТЗ-E — `/me/promises` (client).
 *
 * - Фильтр «Открытые / Только Asked / Все».
 * - Таблица (desktop) / карточки (mobile): текст, откуда, кому, срок, статус.
 * - «Откуда» — ссылка на встречу-источник (если обещание извлечено из встречи).
 * - Просроченный срок (dueDate в прошлом + статус open/asked) подсвечен красным.
 * - Кнопки «Сделано», «Не сделано», «Перенести срок» — закрывают / двигают
 *   обещание через POST /:blockId/mark и PATCH /:blockId/reschedule.
 *
 * Редизайн Ф7б — под таблицей обещаний отдельная секция «Открытые вопросы»:
 * блоки-обещания, которым не хватает данных до полноценного обещания (нет
 * автора / нет ответственного и срока). Это НЕ обещания — по ним нужно
 * договориться, поэтому они вынесены отдельно и не считаются обещаниями.
 *
 * Видны ТОЛЬКО свои обещания — backend изолирует список через
 * `Person.userId === currentUserId`.
 */
export function MyPromisesClient() {
  const [items, setItems] = useState<CommitmentApi[]>([]);
  const [openQuestions, setOpenQuestions] = useState<OpenQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'asked' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  // ТЗ-E — какое обещание сейчас переносим и на какую дату (YYYY-MM-DD).
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>('');

  const refresh = useCallback(() => {
    setLoading(true);
    promisesApi
      .list({ status: filter, limit: 100 })
      .then((res) => {
        setItems(res.items);
        setOpenQuestions((res.openQuestions ?? []).map(openQuestionFromApi));
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'forbidden') {
          setError(
            'У вас нет Person-записи в этой организации — обещания недоступны. Обратитесь к администратору.',
          );
        } else {
          setError(
            err instanceof Error ? err.message : 'Не удалось загрузить обещания',
          );
        }
      })
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mark = async (
    blockId: string,
    status: 'fulfilled' | 'missed' | 'cancelled',
  ) => {
    setBusyId(blockId);
    try {
      await promisesApi.mark(blockId, { status });
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Не удалось закрыть обещание',
      );
    } finally {
      setBusyId(null);
    }
  };

  const openReschedule = (blockId: string) => {
    setRescheduleId(blockId);
    setRescheduleDate(defaultRescheduleDate());
  };

  const cancelReschedule = () => {
    setRescheduleId(null);
    setRescheduleDate('');
  };

  const submitReschedule = async (blockId: string) => {
    if (!rescheduleDate) {
      toast.error('Выберите новую дату');
      return;
    }
    // Конец выбранного дня в локальной зоне → ISO (с offset Z). Гарантирует,
    // что срок строго в будущем при выборе сегодня/завтра.
    const due = new Date(`${rescheduleDate}T23:59:59`);
    if (Number.isNaN(due.getTime())) {
      toast.error('Некорректная дата');
      return;
    }
    setBusyId(blockId);
    try {
      await promisesApi.reschedule(blockId, { dueDate: due.toISOString() });
      cancelReschedule();
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Не удалось перенести срок',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Мои обещания</h1>
        <p className="text-sm text-fg-secondary">
          Список того, что вы пообещали на встречах и в чек-инах. Закройте
          выполненные — и они исчезнут из «открытых».
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm">
          Фильтр:
          <select
            className="ml-2 rounded border px-2 py-1 text-sm"
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as 'open' | 'asked' | 'all')
            }
          >
            <option value="open">Открытые</option>
            <option value="asked">Спросили — жду ответа</option>
            <option value="all">Все</option>
          </select>
        </label>
        <button
          type="button"
          onClick={refresh}
          className="rounded border px-3 py-1 text-sm"
        >
          Обновить
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-fg-secondary">Загрузка…</p>
      ) : error ? (
        <p className="rounded border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          {error}
        </p>
      ) : items.length === 0 && openQuestions.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          Пока нет обещаний — Кора добавит их из встреч.
        </p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              {filter === 'open'
                ? 'Открытых обещаний нет — отлично!'
                : 'Здесь пусто.'}
            </p>
          ) : (
            <>
          {/* Desktop — таблица (≥ sm). */}
          <table className="hidden w-full divide-y rounded border bg-bg-card text-sm sm:table">
            <thead className="bg-bg-subtle text-xs text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Обещание</th>
                <th className="px-3 py-2 text-left">Откуда</th>
                <th className="px-3 py-2 text-left">Кому</th>
                <th className="px-3 py-2 text-left">Срок</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.text}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    <SourceLink commitment={c} />
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {c.recipientPersonName ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <DueDate commitment={c} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {rescheduleId === c.id ? (
                      <RescheduleControls
                        value={rescheduleDate}
                        min={defaultRescheduleDate()}
                        busy={busyId === c.id}
                        onChange={setRescheduleDate}
                        onSubmit={() => submitReschedule(c.id)}
                        onCancel={cancelReschedule}
                      />
                    ) : (
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => mark(c.id, 'fulfilled')}
                          disabled={busyId === c.id}
                          className="rounded bg-success px-2 py-1 text-xs text-success-fg disabled:opacity-50"
                        >
                          Сделано
                        </button>
                        <button
                          type="button"
                          onClick={() => mark(c.id, 'missed')}
                          disabled={busyId === c.id}
                          className="rounded bg-danger px-2 py-1 text-xs text-danger-fg disabled:opacity-50"
                        >
                          Не сделано
                        </button>
                        <button
                          type="button"
                          onClick={() => openReschedule(c.id)}
                          disabled={busyId === c.id}
                          className="rounded border px-2 py-1 text-xs text-fg-secondary disabled:opacity-50"
                        >
                          Перенести срок
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile — карточки (< sm). */}
          <div className="flex flex-col gap-3 sm:hidden">
            {items.map((c) => (
              <div
                key={c.id}
                className="rounded border bg-bg-card p-3 text-sm"
              >
                <div className="mb-2 font-medium">{c.text}</div>
                <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-fg-secondary">Откуда</dt>
                  <dd>
                    <SourceLink commitment={c} />
                  </dd>
                  <dt className="text-fg-secondary">Кому</dt>
                  <dd className="text-fg-secondary">
                    {c.recipientPersonName ?? '—'}
                  </dd>
                  <dt className="text-fg-secondary">Срок</dt>
                  <dd>
                    <DueDate commitment={c} />
                  </dd>
                  <dt className="text-fg-secondary">Статус</dt>
                  <dd>
                    <StatusBadge status={c.status} />
                  </dd>
                </dl>
                {rescheduleId === c.id ? (
                  <RescheduleControls
                    value={rescheduleDate}
                    min={defaultRescheduleDate()}
                    busy={busyId === c.id}
                    onChange={setRescheduleDate}
                    onSubmit={() => submitReschedule(c.id)}
                    onCancel={cancelReschedule}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => mark(c.id, 'fulfilled')}
                      disabled={busyId === c.id}
                      className="rounded bg-success px-2 py-1 text-xs text-success-fg disabled:opacity-50"
                    >
                      Сделано
                    </button>
                    <button
                      type="button"
                      onClick={() => mark(c.id, 'missed')}
                      disabled={busyId === c.id}
                      className="rounded bg-danger px-2 py-1 text-xs text-danger-fg disabled:opacity-50"
                    >
                      Не сделано
                    </button>
                    <button
                      type="button"
                      onClick={() => openReschedule(c.id)}
                      disabled={busyId === c.id}
                      className="rounded border px-2 py-1 text-xs text-fg-secondary disabled:opacity-50"
                    >
                      Перенести срок
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
            </>
          )}

          {/* Редизайн Ф7б — открытые вопросы (НЕ обещания), отдельной секцией. */}
          {openQuestions.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-1 text-sm font-semibold text-fg-primary">
                Открытые вопросы
              </h2>
              <p className="mb-3 text-xs text-fg-secondary">
                Это не обещания, по ним нужно договориться.
              </p>
              <ul className="flex flex-col gap-2">
                {openQuestions.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-3"
                  >
                    <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-full bg-chip-info-bg text-chip-info-fg">
                      <QuestionIcon />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-fg-primary">
                        {q.text}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-secondary">
                        <OpenQuestionMeta question={q} />
                      </div>
                    </div>
                    <span className="flex-none rounded bg-chip-info-bg px-2 py-0.5 text-xs font-medium text-chip-info-fg">
                      открытый вопрос
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Мета открытого вопроса: где упомянуто (ссылка на встречу-источник, если есть)
 * + причина, почему это пока не обещание (RU-текст с бэка).
 */
function OpenQuestionMeta({ question }: { question: OpenQuestion }) {
  return (
    <>
      {question.meetingId ? (
        <>
          <span>упомянуто на встрече </span>
          <Link
            href={`/meetings/${encodeURIComponent(question.meetingId)}/result`}
            className="text-chip-info-fg underline-offset-2 hover:underline"
          >
            {question.meetingTitle ?? 'встреча'}
          </Link>
          <span> · {question.reason}</span>
        </>
      ) : (
        <span>{question.reason}</span>
      )}
    </>
  );
}

/** Иконка «вопрос» для строки открытого вопроса. */
function QuestionIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Ссылка на встречу-источник обещания, либо «—». */
function SourceLink({ commitment }: { commitment: CommitmentApi }) {
  if (!commitment.sourceMeetingId) {
    return <span className="text-fg-tertiary">—</span>;
  }
  return (
    <Link
      href={`/meetings/${encodeURIComponent(commitment.sourceMeetingId)}/result`}
      className="text-chip-info-fg underline-offset-2 hover:underline"
    >
      {commitment.sourceMeetingTitle ?? 'Встреча'}
    </Link>
  );
}

/** Срок обещания; просроченный (open/asked + дата в прошлом) — красным. */
function DueDate({ commitment }: { commitment: CommitmentApi }) {
  if (!commitment.dueDate) {
    return <span className="text-fg-secondary">—</span>;
  }
  const overdue = isOverdue(commitment);
  return (
    <span className={overdue ? 'font-medium text-chip-danger-fg' : 'text-fg-secondary'}>
      {formatDate(commitment.dueDate)}
      {overdue ? ' · просрочено' : ''}
    </span>
  );
}

/** Инлайн-контролы переноса срока: дата + «Перенести» / «Отмена». */
function RescheduleControls({
  value,
  min,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  min: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center justify-end gap-1">
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="rounded bg-success px-2 py-1 text-xs text-success-fg disabled:opacity-50"
      >
        Перенести
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded border px-2 py-1 text-xs text-fg-secondary disabled:opacity-50"
      >
        Отмена
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: CommitmentStatusApi | null }) {
  if (status === null) {
    return <span className="text-xs text-fg-tertiary">—</span>;
  }
  const label =
    status === 'open'
      ? 'открыто'
      : status === 'asked'
        ? 'жду ответа'
        : status === 'fulfilled'
          ? 'выполнено'
          : status === 'missed'
            ? 'не выполнено'
            : status === 'cancelled'
              ? 'отменено'
              : 'заменено';
  const colour =
    status === 'fulfilled'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : status === 'missed'
        ? 'bg-chip-danger-bg text-chip-danger-fg'
        : status === 'asked'
          ? 'bg-chip-warning-bg text-chip-warning-fg'
          : status === 'cancelled' || status === 'superseded'
            ? 'bg-bg-subtle text-fg-secondary'
            : 'bg-chip-info-bg text-chip-info-fg';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}

/** Обещание просрочено: срок в прошлом и оно ещё не закрыто. */
function isOverdue(c: CommitmentApi): boolean {
  if (!c.dueDate) return false;
  if (c.status !== 'open' && c.status !== 'asked') return false;
  return new Date(c.dueDate).getTime() < Date.now();
}

/** Дефолт для переноса — завтра (бэк требует строго будущую дату). */
function defaultRescheduleDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU');
}
