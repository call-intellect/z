'use client';

import { Plus, Table as TableIcon } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';

export function EmptyState({
  onAddRow,
  onAddColumnClick,
  hasProperties,
  isMutating,
}: {
  onAddRow: () => Promise<void> | void;
  onAddColumnClick: () => void;
  hasProperties: boolean;
  isMutating: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border-subtle bg-bg-card px-6 py-16 text-center">
      <TableIcon className="mb-3 h-10 w-10 text-fg-secondary" />
      <h2 className="text-base font-medium text-fg-primary">
        Таблица пустая
      </h2>
      <p className="mt-1 max-w-sm text-sm text-fg-secondary">
        Добавьте колонку и строку, чтобы начать. Поддерживаются 14 типов
        колонок — от текста и чисел до статусов и людей.
      </p>
      <div className="mt-4 flex gap-2">
        {hasProperties ? (
          <Button
            size="sm"
            onClick={() => void onAddRow()}
            disabled={isMutating}
          >
            <Plus className="h-4 w-4" />
            Добавить строку
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onAddColumnClick}
            disabled={isMutating}
          >
            <Plus className="h-4 w-4" />
            Добавить колонку
          </Button>
        )}
      </div>
    </div>
  );
}
