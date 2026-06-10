'use client';

/**
 * `/tables` — индекс Smart Tables.
 *
 * Notion-стиль grid карточек: иконка типа в круге, название, метаданные
 * (тип сущности, описание), относительное время обновления. Sticky-header
 * с CTA «Новая таблица» в правом углу.
 *
 * Создание: prompt(name) → POST /api/v1/tables → router.push.
 * Полноценный диалог с настройкой колонок будет в следующей фазе.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { FileSpreadsheet, Plus, Sparkles, Table2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { tablesApi } from '@/api/tables.api';
import type { TableApi } from '@/api/types/tables';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { CONCIERGE_OPEN_EVENT } from '@/ui/concierge/ConciergeFloatingButton';

import { ImportFromFileDialog } from './components/ImportFromFileDialog';

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
        description="Вы не состоите ни в одной организации."
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
  const [importOpen, setImportOpen] = useState(false);

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

  // «Спросить Кору» — открываем Concierge с префилл-сообщением. Сам инференс
  // схемы делает Concierge через свой tool `infer_table_schema`. Гейтинг
  // (feature.tables_text_to_schema) на backend: если выключено — ассистент
  // ответит, что функция отключена (фронт не знает этот флаг).
  const onAskConcierge = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(CONCIERGE_OPEN_EVENT, {
        detail: { prefill: 'Помогите создать таблицу для ' },
      }),
    );
  }, []);

  if (isLoading && !items) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!items) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <header className="sticky top-0 z-10 -mx-6 mb-6 flex items-end justify-between gap-4 border-b border-border-subtle/40 bg-bg-base/85 px-6 pb-4 pt-4 backdrop-blur supports-[backdrop-filter]:bg-bg-base/70">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg-primary">
            Таблицы
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {total === 0
              ? 'Создайте первую таблицу для команды'
              : `Всего ${total} · показано ${items.length}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={onAskConcierge}
            variant="secondary"
            size="sm"
          >
            <Sparkles className="h-4 w-4" />
            Спросить Кору
          </Button>
          <Button
            onClick={() => setImportOpen(true)}
            variant="secondary"
            size="sm"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Из файла
          </Button>
          <Button onClick={onCreate} disabled={isCreating} size="sm">
            <Plus className="h-4 w-4" />
            Создать таблицу
          </Button>
        </div>
      </header>

      {importOpen ? (
        <ImportFromFileDialog
          orgId={orgId}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyTablesList onCreate={onCreate} isCreating={isCreating} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => (
            <li key={t.id}>
              <TableCard table={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────── TableCard ─────────────────────────────────

function TableCard({ table }: { table: TableApi }) {
  const updated = useMemo(() => new Date(table.updatedAt), [table.updatedAt]);
  const updatedText = useMemo(() => {
    try {
      return formatDistanceToNow(updated, { addSuffix: true, locale: ru });
    } catch {
      return updated.toLocaleDateString('ru-RU');
    }
  }, [updated]);

  // Тип привязки в entitySync — мини-чип под названием.
  const entityBadge = useMemo(() => {
    const t = (table.entitySync as { type?: unknown } | null)?.type;
    if (typeof t !== 'string') return null;
    const labels: Record<string, string> = {
      org: 'Организации',
      person: 'Люди',
      meeting: 'Встречи',
      document: 'Документы',
    };
    return labels[t] ?? null;
  }, [table.entitySync]);

  return (
    <Link
      href={`/tables/${table.id}`}
      className="group flex h-full flex-col gap-3 rounded-xl border border-border-subtle/40 bg-bg-card p-4 transition-all duration-150 hover:-translate-y-[0.5px] hover:border-border-strong/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
          {table.icon ? (
            <span className="text-lg leading-none" aria-hidden>
              {table.icon}
            </span>
          ) : (
            <Table2 className="h-5 w-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-base font-medium text-fg-primary group-hover:text-fg-primary">
              {table.name}
            </span>
            {table.isSystem ? (
              <span
                className="shrink-0 text-sm leading-none"
                aria-label="Системная таблица"
                title="Системная таблица — её можно архивировать, но не удалить навсегда"
              >
                🔒
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-fg-tertiary">
            Обновлено {updatedText}
          </div>
        </div>
      </div>

      {table.description ? (
        <p className="line-clamp-2 text-sm text-fg-secondary">
          {table.description}
        </p>
      ) : (
        <p className="text-sm italic text-fg-tertiary">
          Без описания
        </p>
      )}

      {entityBadge ? (
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <span className="inline-flex items-center rounded-full bg-chip-info-bg/15 px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
            {entityBadge}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

function EmptyTablesList({
  onCreate,
  isCreating,
}: {
  onCreate: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-bg-card px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted text-accent">
        <Table2 className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-medium text-fg-primary">
        Пока нет таблиц
      </h2>
      <p className="mt-1 max-w-sm text-sm text-fg-secondary">
        Smart-таблицы — это база знаний команды: задачи, клиенты, идеи. Каждая
        строка может быть связана с сущностями графа.
      </p>
      <Button
        size="sm"
        onClick={onCreate}
        disabled={isCreating}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Создать таблицу
      </Button>
    </div>
  );
}
