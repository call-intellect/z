"use client";

import {
  AtSign,
  Calendar,
  CheckSquare,
  CircleDot,
  Hash,
  Link as LinkIcon,
  List,
  ListChecks,
  Percent,
  Phone,
  RussianRuble,
  Text as TextIcon,
  User as UserIcon,
} from "lucide-react";

import {
  FAZA1_CREATABLE_TYPES,
  PROP_TYPE_LABEL_RU,
  type TablePropType,
} from "@/domain/table";
import { cn } from "@/ui/shadcn/lib/utils";

const TYPE_ICONS: Record<
  TablePropType,
  React.ComponentType<{ className?: string }>
> = {
  text: TextIcon,
  longtext: TextIcon,
  number: Hash,
  currency: RussianRuble,
  percent: Percent,
  date: Calendar,
  status: CircleDot,
  selectSingle: List,
  selectMulti: ListChecks,
  checkbox: CheckSquare,
  person: UserIcon,
  url: LinkIcon,
  email: AtSign,
  phone: Phone,
  file: TextIcon,
  formula: TextIcon,
  relation: TextIcon,
  rollup: TextIcon,
  createdAt: Calendar,
  updatedAt: Calendar,
  createdBy: UserIcon,
  entityLink: TextIcon,
  meetingLink: TextIcon,
  documentLink: TextIcon,
};

const TYPE_HINTS: Partial<Record<TablePropType, string>> = {
  text: "Короткий текст до 255 символов",
  longtext: "Длинный текст, абзацы",
  number: "Целое или дробное число",
  currency: "Сумма в рублях",
  percent: "Доля или процент",
  date: "Дата и время",
  status: "Статус с цветной меткой",
  selectSingle: "Один вариант из списка",
  selectMulti: "Несколько вариантов",
  checkbox: "Да / нет",
  person: "Сотрудник из команды",
  url: "Ссылка с https://",
  email: "Электронная почта",
  phone: "Номер телефона",
};

export function ColumnTypeSelector({
  selected,
  onSelect,
}: {
  selected: TablePropType | null;
  onSelect: (type: TablePropType) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="px-1 text-xs font-medium text-fg-secondary">
        Выберите тип колонки
      </div>
      <div className="flex flex-col gap-1">
        {FAZA1_CREATABLE_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t];
          const isSelected = selected === t;
          const hint = TYPE_HINTS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                "border-transparent text-fg-primary hover:border-border-subtle hover:bg-bg-overlay",
                isSelected &&
                  "border-accent-border bg-accent-muted text-accent hover:border-accent-border",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  isSelected
                    ? "bg-accent-muted-strong text-accent"
                    : "bg-bg-subtle text-fg-secondary",
                )}
                aria-hidden
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {PROP_TYPE_LABEL_RU[t]}
                </span>
                {hint ? (
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-xs",
                      isSelected ? "text-accent/80" : "text-fg-tertiary",
                    )}
                  >
                    {hint}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
