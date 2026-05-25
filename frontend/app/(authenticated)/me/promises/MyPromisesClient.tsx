'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  promisesApi,
  type CommitmentApi,
  type CommitmentStatusApi,
} from '@/api/promises.api';
import { toast } from 'sonner';

/**
 * SBA β-8.2 — `/me/promises` (client).
 *
 * - Фильтр «Открытые / Только Asked / Все».
 * - Таблица: текст обещания, кому, срок, статус.
 * - Кнопки «Сделано», «Не сделано», «Отменить» — закрывают обещание через
 *   POST /:blockId/mark.
 *
 * Видны ТОЛЬКО свои обещания — backend изолирует список через
 * `Person.userId === currentUserId`.
 */
export function MyPromisesClient() {
  const [items, setItems] = useState<CommitmentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'asked' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    promisesApi
      .list({ status: filter, limit: 100 })
      .then((res) => {
        setItems(res.items);
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
      toast.error(err instanceof Error ? err.message : 'Не удалось закрыть обещание');
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
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          {filter === 'open'
            ? 'Открытых обещаний нет — отлично!'
            : 'Здесь пусто.'}
        </p>
      ) : (
        <table className="w-full divide-y rounded border bg-white text-sm">
          <thead className="bg-bg-subtle text-xs text-fg-secondary">
            <tr>
              <th className="px-3 py-2 text-left">Обещание</th>
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
                  {c.recipientPersonName ?? '—'}
                </td>
                <td className="px-3 py-2 text-fg-secondary">{formatDate(c.dueDate)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => mark(c.id, 'fulfilled')}
                      disabled={busyId === c.id}
                      className="rounded bg-success px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Сделано
                    </button>
                    <button
                      type="button"
                      onClick={() => mark(c.id, 'missed')}
                      disabled={busyId === c.id}
                      className="rounded bg-danger px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Не сделано
                    </button>
                    <button
                      type="button"
                      onClick={() => mark(c.id, 'cancelled')}
                      disabled={busyId === c.id}
                      className="rounded border px-2 py-1 text-xs text-fg-secondary disabled:opacity-50"
                    >
                      Отменить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU');
}
