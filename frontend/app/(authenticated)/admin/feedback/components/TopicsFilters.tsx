'use client';

/**
 * TopicsFilters — фильтры дашборда обратной связи: окно агрегатов, поиск,
 * чекбокс «Показывать архивированные». Все тексты — только русские.
 */

import { Search } from 'lucide-react';

import {
  FEEDBACK_WINDOW_LABEL,
  type FeedbackWindow,
} from '@/domain/admin-feedback';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

const WINDOW_OPTIONS: FeedbackWindow[] = ['30', '90', 'all'];

interface TopicsFiltersProps {
  window: FeedbackWindow;
  onWindowChange: (w: FeedbackWindow) => void;
  search: string;
  onSearchChange: (v: string) => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (v: boolean) => void;
}

export function TopicsFilters({
  window,
  onWindowChange,
  search,
  onSearchChange,
  includeArchived,
  onIncludeArchivedChange,
}: TopicsFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={window}
        onValueChange={(v) => onWindowChange(v as FeedbackWindow)}
      >
        <SelectTrigger className="h-9 w-44 bg-white text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOW_OPTIONS.map((w) => (
            <SelectItem key={w} value={w}>
              {FEEDBACK_WINDOW_LABEL[w]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary"
        />
        <input
          type="text"
          placeholder="Поиск по теме и описанию"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 w-72 rounded-md border border-border-subtle bg-white pl-7 pr-3 text-sm"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <Checkbox
          checked={includeArchived}
          onCheckedChange={(v) => onIncludeArchivedChange(v === true)}
        />
        Показывать архивированные
      </label>
    </div>
  );
}
