'use client';

import { Bell, Plus, Table2 } from 'lucide-react';

import type { TableDomain } from '@/domain/table';
import { Button } from '@/ui/shadcn/button';

import { AddColumnButton } from './AddColumnButton';
import { ViewSelector } from './ViewSelector';
import type { TablePropType } from '@/domain/table';

/**
 * Шапка страницы таблицы — название + иконка в круге + кнопки действий.
 *
 * Без новой функциональности: только полировка стиля (парные токены, hover,
 * иконка таблицы в круге как на индексной странице).
 *
 * Поиск/фильтры/sort'ы — отдельный `ViewSelector` ниже (он управляет saved
 * views и draftConfig).
 */
export function TableHeader({
  table,
  onAddRow,
  onAddColumn,
  isMutating,
  pendingCount,
  onOpenPending,
}: {
  table: TableDomain;
  onAddRow: () => Promise<void> | void;
  onAddColumn: (type: TablePropType, name: string) => Promise<void> | void;
  isMutating: boolean;
  /** Кол-во правок ячеек, ожидающих подтверждения (Фаза 3). */
  pendingCount: number;
  /** Открыть панель очереди подтверждений. */
  onOpenPending: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
            {table.icon ? (
              <span className="text-lg leading-none" aria-hidden>
                {table.icon}
              </span>
            ) : (
              <Table2 className="h-5 w-5" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-fg-primary">
              {table.name}
            </h1>
            {table.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">
                {table.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {pendingCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenPending}
              aria-label={`Правки на подтверждении: ${pendingCount}`}
              className="border-warning/40 text-warning hover:bg-warning/10"
            >
              <Bell className="h-4 w-4" />
              Правки на подтверждении: {pendingCount}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onAddRow()}
            disabled={isMutating}
            aria-label="Добавить строку"
            className="transition-colors hover:bg-bg-overlay"
          >
            <Plus className="h-4 w-4" />
            Строка
          </Button>
          <AddColumnButton onCreate={onAddColumn} disabled={isMutating} />
        </div>
      </div>
      <ViewSelector tableId={table.id} />
    </div>
  );
}
