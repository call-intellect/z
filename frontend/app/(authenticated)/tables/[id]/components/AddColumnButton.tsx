"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { PROP_TYPE_LABEL_RU, type TablePropType } from "@/domain/table";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

import { ColumnTypeSelector } from "./ColumnTypeSelector";

export function AddColumnButton({
  onCreate,
  disabled,
}: {
  onCreate: (type: TablePropType, name: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TablePropType | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setType(null);
    setName("");
    setSubmitting(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const submit = async () => {
    if (!type || !name.trim()) return;
    setSubmitting(true);
    try {
      await onCreate(type, name.trim());
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-label="Добавить колонку"
        >
          <Plus className="h-4 w-4" />
          Колонка
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem]">
        {type === null ? (
          <ColumnTypeSelector selected={type} onSelect={(t) => setType(t)} />
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-medium text-fg-secondary">
              Новая колонка типа «{PROP_TYPE_LABEL_RU[type]}»
            </div>
            <Input
              autoFocus
              placeholder="Например, Имя клиента"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape") onOpenChange(false);
              }}
              disabled={submitting}
              aria-label="Название колонки"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setType(null)}
                disabled={submitting}
              >
                Назад
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  Отменить
                </Button>
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={submitting || !name.trim()}
                >
                  {submitting ? "Создание..." : "Создать"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
