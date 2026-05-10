'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  personsApi,
  type ListPersonsResultApi,
} from '@/api/persons.api';
import { useAuth } from '@/contexts/auth-context';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../admin/AdminStateViews';

const ERASED_NAME = '[удалено по запросу]';

/**
 * `/persons` — простой список персон Org. Минимальный экран для шага 13
 * Фазы 11 (после удаления данных мы сюда редиректим).
 */
export function PersonsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org."
      />
    );
  }
  return <PersonsListContent orgId={currentOrgId} />;
}

function PersonsListContent({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ListPersonsResultApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await personsApi.list(orgId, {
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') setForbidden(true);
      else setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
    } finally {
      setIsLoading(false);
    }
  }, [orgId, q]);

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
        <h1 className="text-2xl font-semibold">Персоны</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по имени или алиасу"
          className="max-w-md"
        />
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-fg-tertiary">Персон не найдено.</p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
          {data.items.map((p) => {
            const isErased = p.canonicalName === ERASED_NAME;
            return (
              <li key={p.id}>
                <Link
                  href={`/persons/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-bg-overlay"
                >
                  <div>
                    <div
                      className={
                        isErased
                          ? 'text-sm italic text-fg-tertiary'
                          : 'text-sm font-medium'
                      }
                    >
                      {p.canonicalName}
                    </div>
                    {p.aliases.length > 0 && !isErased && (
                      <div className="mt-0.5 text-xs text-fg-tertiary">
                        {p.aliases.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="text-xs tabular-nums text-fg-tertiary">
                    упоминаний: {p.mentionsCount}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
