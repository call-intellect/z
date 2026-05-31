'use client';

/**
 * `/tables` — индекс Smart Tables.
 *
 * Минимальный MVP для §1.5 smart-tables: список таблиц tenant'а с переходом
 * на `/tables/[id]` и быстрым созданием новой через prompt.
 *
 * Создание: prompt(name) → POST /api/v1/tables → router.push.
 * Полноценный диалог с настройкой колонок будет в следующей фазе.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Table2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { tablesApi } from '@/api/tables.api';
import type { TableApi } from '@/api/types/tables';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

export function TablesListClient() {
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
  return <TablesListContent orgId={currentOrgId} />;
}

function TablesListContent({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<TableApi[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await tablesApi.list(orgId, { archived: 'active', limit: 100 });
      setItems(dto.items);
      setTotal(dto.total);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = useCallback(async () => {
    const name = window.prompt('Название новой таблицы:');
    if (!name || !name.trim()) return;
    setIsCreating(true);
    try {
      const created = await tablesApi.create(orgId, { name: name.trim() });
      router.push(`/tables/${created.id}`);
    } catch (e) {
      window.alert(
        e instanceof ApiError ? e.message : 'Не удалось создать таблицу',
      );
    } finally {
      setIsCreating(false);
    }
  }, [orgId, router]);

  if (isLoading && !items) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!items) return null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Таблицы</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Всего: {total}. Показано: {items.length}.
          </p>
        </div>
        <Button onClick={onCreate} disabled={isCreating} size="sm">
          <Plus className="h-4 w-4" />
          Новая таблица
        </Button>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card px-6 py-10 text-center">
          <Table2 className="mx-auto h-8 w-8 text-fg-tertiary" />
          <p className="mt-3 text-sm text-fg-secondary">
            Ещё нет ни одной таблицы.
          </p>
          <p className="mt-1 text-xs text-fg-tertiary">
            Нажмите «Новая таблица», чтобы создать первую.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tables/${t.id}`}
                className="block rounded-lg border border-border-subtle bg-bg-card px-4 py-3 transition-colors hover:border-border-strong hover:bg-bg-hover"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{t.icon ?? '📊'}</span>
                  <span className="truncate text-sm font-medium">{t.name}</span>
                </div>
                {t.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
                    {t.description}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
