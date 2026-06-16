'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Sparkles, TrendingDown, TrendingUp, Minus } from 'lucide-react';

import { themesApi } from '@/api/themes.api';
import { pluralRu } from '@/domain/contribution';
import {
  THEME_BRANCH_LABELS,
  THEME_BRANCH_VALUES,
  THEME_DYNAMIC_LABELS,
  type ThemeBranch,
  type ThemeDomain,
  type ThemeDynamic,
  type ThemeStatus,
  themeFromApi,
} from '@/domain/theme';
import { QueryGate } from '@/ui/components/shared/QueryGate';
import { EmptyState as SharedEmptyState } from '@/ui/components/shared/EmptyState';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

type BranchOption = { value: ThemeBranch | 'all'; label: string };

const BRANCH_OPTIONS: BranchOption[] = [
  { value: 'all', label: 'Все ветки' },
  ...THEME_BRANCH_VALUES.map((b) => ({ value: b, label: THEME_BRANCH_LABELS[b] })),
];

const DYNAMIC_ICONS: Record<ThemeDynamic, typeof TrendingUp> = {
  growing: TrendingUp,
  stable: Minus,
  declining: TrendingDown,
};

const DYNAMIC_TONE: Record<ThemeDynamic, string> = {
  growing: 'text-success',
  stable: 'text-fg-tertiary',
  declining: 'text-warning',
};

export function ThemesClient() {
  const [branch, setBranch] = useState<ThemeBranch | 'all'>('all');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const status: ThemeStatus = showArchived ? 'archived' : 'active';

  const swrKey = useMemo(
    () => ['themes', branch, q, status] as const,
    [branch, q, status],
  );

  const { data, isLoading, error } = useSWR(swrKey, async () => {
    const res = await themesApi.list({
      ...(branch !== 'all' ? { branch } : {}),
      status,
      ...(q.trim() ? { q: q.trim() } : {}),
      limit: 100,
    });
    return res.items.map(themeFromApi);
  });

  const themes = data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-semibold">Темы</h1>
          <p className="text-sm text-fg-tertiary">
            Темы — это кластеры идей, которые Кора собрала из ваших встреч.
            Когда тема становится важной для бизнеса — сохраните её как
            карточку и продолжайте работать в привычной структуре.
          </p>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Поиск по названию темы"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={branch}
          onValueChange={(v) => setBranch(v as BranchOption['value'])}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Ветка" />
          </SelectTrigger>
          <SelectContent>
            {BRANCH_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={showArchived ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowArchived((s) => !s)}
        >
          {showArchived ? 'Показаны архивные' : 'Активные'}
        </Button>
      </div>

      <QueryGate
        isLoading={isLoading}
        error={error}
        isEmpty={themes.length === 0}
        empty={
          <SharedEmptyState
            title="Пока нет тем"
            description="Кора ещё не обнаружила темы. Накопится примерно 100 блоков идей из ваших встреч — здесь появятся первые кластеры."
          />
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => (
            <ThemeListItem key={t.id} theme={t} />
          ))}
        </div>
      </QueryGate>
    </div>
  );
}

function ThemeListItem({ theme }: { theme: ThemeDomain }) {
  const DynamicIcon = DYNAMIC_ICONS[theme.dynamic];
  const branchLabel = theme.branch ? THEME_BRANCH_LABELS[theme.branch] : null;

  return (
    <Link
      href={`/themes/${encodeURIComponent(theme.id)}`}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-elevated p-4 transition-colors',
        'hover:border-accent/60 hover:bg-bg-overlay',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/20 text-accent">
          <Sparkles size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-base font-medium">{theme.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
            {branchLabel && (
              <span className="rounded-full bg-bg-overlay px-2 py-0.5">
                {branchLabel}
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1',
                DYNAMIC_TONE[theme.dynamic],
              )}
            >
              <DynamicIcon size={12} />
              {THEME_DYNAMIC_LABELS[theme.dynamic]}
            </span>
          </div>
        </div>
      </div>
      {theme.description && (
        <p className="line-clamp-3 text-sm text-fg-secondary">
          {theme.description}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between text-xs text-fg-tertiary">
        <span>
          {pluralRu(theme.blocksCount, 'блок', 'блока', 'блоков')} · {pluralRu(theme.entitiesCount, 'сущность', 'сущности', 'сущностей')}
        </span>
      </div>
    </Link>
  );
}
