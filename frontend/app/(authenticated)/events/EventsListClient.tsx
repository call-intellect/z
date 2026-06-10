'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  eventsApi,
  type EventKindApi,
  type EventsListResponseApi,
} from '@/api/events.api';
import { useAuth } from '@/contexts/auth-context';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const KIND_LABEL: Record<EventKindApi, string> = {
  meeting: 'Встреча',
  incident: 'Инцидент',
  release: 'Релиз',
  transition: 'Переход',
  milestone: 'Веха',
  other: 'Другое',
};

/**
 * `/events` — список событий Org (SBA α-3).
 */
export function EventsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <EventsListContent />;
}

function EventsListContent() {
  const [data, setData] = useState<EventsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await eventsApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">События</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по заголовку или месту"
          className="max-w-md"
        />
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-fg-tertiary">Событий не найдено.</p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
          {data.items.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{e.title}</div>
                <div className="mt-0.5 text-xs text-fg-tertiary">
                  {KIND_LABEL[e.kind]} ·{' '}
                  {new Date(e.startAt).toLocaleString('ru-RU', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
              <div className="text-xs tabular-nums text-fg-tertiary">
                {e.durationMin ? `${e.durationMin} мин` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
