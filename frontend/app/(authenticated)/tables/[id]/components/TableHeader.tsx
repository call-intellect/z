'use client';

import { Plus } from 'lucide-react';

import type { TableDomain } from '@/domain/table';
import { Button } from '@/ui/shadcn/button';

import { AddColumnButton } from './AddColumnButton';
import type { TablePropType } from '@/domain/table';

export function TableHeader({
  table,
  onAddRow,
  onAddColumn,
  isMutating,
}: {
  table: TableDomain;
  onAddRow: () => Promise<void> | void;
  onAddColumn: (type: TablePropType, name: string) => Promise<void> | void;
  isMutating: boolean;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {table.icon ? (
            <span className="text-xl" aria-hidden>
              {table.icon}
            </span>
          ) : null}
          <h1 className="truncate text-2xl font-semibold text-fg-primary">
            {table.name}
          </h1>
        </div>
        {table.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">
            {table.description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onAddRow()}
          disabled={isMutating}
          aria-label="Добавить строку"
        >
          <Plus className="h-4 w-4" />
          Строка
        </Button>
        <AddColumnButton onCreate={onAddColumn} disabled={isMutating} />
      </div>
    </div>
  );
}
