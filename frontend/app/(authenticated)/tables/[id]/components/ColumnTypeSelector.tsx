'use client';

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
} from 'lucide-react';

import {
  FAZA1_CREATABLE_TYPES,
  PROP_TYPE_LABEL_RU,
  type TablePropType,
} from '@/domain/table';
import { cn } from '@/ui/shadcn/lib/utils';

const TYPE_ICONS: Record<TablePropType, React.ComponentType<{ className?: string }>> = {
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
  // unused в creatable, но требуется по Record:
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

export function ColumnTypeSelector({
  selected,
  onSelect,
}: {
  selected: TablePropType | null;
  onSelect: (type: TablePropType) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-fg-secondary px-1">
        Выберите тип колонки
      </div>
      <div className="grid grid-cols-2 gap-1">
        {FAZA1_CREATABLE_TYPES.map((t) => {
          const Icon = TYPE_ICONS[t];
          const isSelected = selected === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                'border-border-subtle text-fg-primary hover:bg-bg-overlay',
                isSelected &&
                  'border-accent-border bg-accent-muted text-accent',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{PROP_TYPE_LABEL_RU[t]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
