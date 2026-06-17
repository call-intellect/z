"use client";

import { Plus, TableProperties } from "lucide-react";

import { Button } from "@/ui/shadcn/button";

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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-bg-card px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted text-accent">
        <TableProperties className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-medium text-fg-primary">
        {hasProperties
          ? "В этой таблице пока нет строк"
          : "Пока пустая таблица"}
      </h2>
      <p className="mt-1 max-w-sm text-sm text-fg-secondary">
        {hasProperties
          ? "Добавьте первую строку, чтобы начать наполнять данные."
          : "Создайте колонку — поддерживаются 14 типов от текста и чисел до статусов и людей."}
      </p>
      <div className="mt-5 flex gap-2">
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
          <Button size="sm" onClick={onAddColumnClick} disabled={isMutating}>
            <Plus className="h-4 w-4" />
            Добавить колонку
          </Button>
        )}
      </div>
    </div>
  );
}
