'use client';

/**
 * Pulse §5.3 (2026-05-30) — Архив гипотез.
 *
 * `/sprints/archive` — хроника всех Cycle tenant'а за период с фильтрами
 * (period / status / search) и сводкой.
 *
 * Источник: `GET /api/v1/sprints/archive?period=&status=&q=`.
 * SaaS-2026 дизайн (ТЗ §1.4): sticky header, card grid, character empty,
 * paired tokens, skeleton loading.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Flag,
  HelpCircle,
  ListChecks,
  Search,
  XCircle,
} from 'lucide-react';

import { Input } from '@/ui/shadcn/input';
import { MiniDonut } from '@/ui/components/dashboard/charts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

import { useAuth } from '@/contexts/auth-context';
import { sprintsApi } from '@/api/tracker/sprints.api';
import type {
  SprintArchiveItemApi,
  SprintArchiveListApi,
  SprintArchivePeriodApi,
  SprintArchiveStatusApi,
} from '@/domain/sprint';
import { formatSprintDateRange } from '@/domain/sprint';

// ─────────────────── debounce ───────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// ─────────────────── chips для статусов ─────────────────────────────────

type StatusChipValue = 'all' | SprintArchiveStatusApi;

const STATUS_CHIPS: Array<{ value: StatusChipValue; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'in_progress', label: 'В процессе' },
  { value: 'cancelled', label: 'Отменены' },
];

// ─────────────────── главный компонент ─────────────────────────────────

export function SprintArchiveClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  const [period, setPeriod] = useState<SprintArchivePeriodApi>('quarter');
  const [status, setStatus] = useState<StatusChipValue>('all');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const swr = useSWR<SprintArchiveListApi>(
    currentOrgId
      ? ['tracker.sprints.archive', currentOrgId, period, status, debouncedSearch]
      : null,
    async () => {
      if (!currentOrgId) throw new Error('orgId required');
      return sprintsApi.archive(currentOrgId, {
        period,
        status: status === 'all' ? undefined : status,
        q: debouncedSearch || undefined,
      });
    },
    { revalidateOnFocus: false },
  );

  const items = swr.data?.items ?? [];
  const summary = swr.data?.summary;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/* Sticky header — фильтры + summary tiles */}
      <header className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-border-subtle bg-bg-base/80 px-4 py-3 backdrop-blur-glass md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/sprints"
              className="inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
            >
              <ArrowLeft size={12} /> К списку спринтов
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-fg-primary md:text-2xl">
              Архив гипотез
            </h1>
            <p className="text-xs text-fg-tertiary">
              Хроника спринтов: что проверяли, что подтвердилось, чему
              научились.
            </p>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="Всего" value={summary.total} tone="info" />
              <SummaryTile
                label="Подтвердились"
                value={summary.confirmed}
                tone="success"
              />
              <SummaryTile
                label="Не подтвердились"
                value={summary.rejected}
                tone="danger"
              />
              <SummaryTile
                label="В процессе"
                value={summary.inProgress}
                tone="info"
              />
            </div>
          )}
        </div>

        <FiltersRow
          period={period}
          onPeriodChange={setPeriod}
          status={status}
          onStatusChange={setStatus}
          searchInput={searchInput}
          onSearchChange={setSearchInput}
        />
      </header>

      {/* Body */}
      {authLoading || !currentOrgId ? (
        <LoadingOrNoOrg loading={authLoading} noOrg={!authLoading && !currentOrgId} />
      ) : swr.isLoading ? (
        <ArchiveSkeleton />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ItemsGrid items={items} />
      )}
    </div>
  );
}

// ─────────────────── filters row ───────────────────────────────────────

interface FiltersRowProps {
  period: SprintArchivePeriodApi;
  onPeriodChange: (v: SprintArchivePeriodApi) => void;
  status: StatusChipValue;
  onStatusChange: (v: StatusChipValue) => void;
  searchInput: string;
  onSearchChange: (v: string) => void;
}

function FiltersRow({
  period,
  onPeriodChange,
  status,
  onStatusChange,
  searchInput,
  onSearchChange,
}: FiltersRowProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
      {/* Period dropdown */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-tertiary">Период:</span>
        <Select
          value={period}
          onValueChange={(v) => onPeriodChange(v as SprintArchivePeriodApi)}
        >
          <SelectTrigger className="h-8 w-auto px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">За месяц</SelectItem>
            <SelectItem value="quarter">За квартал</SelectItem>
            <SelectItem value="year">За год</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_CHIPS.map((chip) => {
          const isActive = status === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onStatusChange(chip.value)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border-subtle bg-bg-elevated text-fg-secondary hover:bg-bg-overlay',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative flex-1 lg:max-w-xs">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
        />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Найти по гипотезе"
          className="pl-9"
          aria-label="Поиск по тексту гипотезы спринта"
        />
      </div>
    </div>
  );
}

// ─────────────────── summary tile ──────────────────────────────────────

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'danger' | 'info';
}) {
  const bg =
    tone === 'success'
      ? 'bg-chip-success-bg'
      : tone === 'danger'
        ? 'bg-chip-danger-bg'
        : 'bg-chip-info-bg';
  const fg =
    tone === 'success'
      ? 'text-chip-success-fg'
      : tone === 'danger'
        ? 'text-chip-danger-fg'
        : 'text-chip-info-fg';
  return (
    <div
      className={cn('rounded-xl px-3 py-2 shadow-card-soft', bg, fg)}
      aria-label={`${label}: ${value}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ─────────────────── items grid ────────────────────────────────────────

function ItemsGrid({ items }: { items: SprintArchiveItemApi[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item, idx) => (
        <div
          key={item.cycleId}
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards"
          style={{ animationDelay: `${Math.min(idx, 9) * 40}ms` }}
        >
          <ArchiveCard item={item} />
        </div>
      ))}
    </div>
  );
}

function ArchiveCard({ item }: { item: SprintArchiveItemApi }) {
  const statusBadge = renderStatusBadge(item);
  const durationDays = computeDurationDays(item.startDate, item.endDate);
  const percent = computeCompletedPercent(item.issuesClosed, item.issuesTotal);
  const donutTone =
    item.status === 'cancelled'
      ? 'neutral'
      : percent === null
        ? 'neutral'
        : percent >= 80
          ? 'success'
          : percent >= 50
            ? 'warning'
            : 'danger';

  return (
    <Link
      href={`/sprints/${encodeURIComponent(item.cycleId)}`}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-xl border border-border-subtle/40 bg-bg-elevated p-5 shadow-card-soft transition-all',
        'hover:-translate-y-0.5 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] uppercase tracking-wide text-fg-tertiary">
            {item.projectName ?? '—'}
          </div>
          <h3 className="mt-0.5 truncate text-base font-semibold text-fg-primary">
            {item.name}
          </h3>
          <div className="mt-1 text-[11px] text-fg-tertiary">
            {formatSprintDateRange(item.startDate, item.endDate)}
          </div>
        </div>
        {statusBadge}
      </div>

      {/* Фаза 7.5 — 3 мини-stat'а в карточке: длительность / % выполнено / задачи */}
      <div className="flex items-center gap-3 rounded-lg bg-bg-overlay/60 px-3 py-2">
        <MiniStat
          icon={<CalendarDays size={11} aria-hidden />}
          label="Длительность"
          value={
            durationDays !== null
              ? `${durationDays} ${pluralRu(durationDays, ['день', 'дня', 'дней'])}`
              : '—'
          }
        />
        <div className="h-8 w-px bg-border-subtle/40" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">
          {percent !== null ? (
            <MiniDonut
              value={percent / 100}
              size={32}
              tone={donutTone}
              centerLabel={`${percent}%`}
            />
          ) : (
            <span className="inline-block h-8 w-8 rounded-full bg-bg-overlay" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
              Выполнено
            </div>
            <div className="truncate text-xs text-fg-secondary">
              {percent !== null ? `${percent}% от плана` : 'нет данных'}
            </div>
          </div>
        </div>
        <div className="h-8 w-px bg-border-subtle/40" aria-hidden />
        <MiniStat
          icon={<ListChecks size={11} aria-hidden />}
          label="Задач"
          value={`${item.issuesClosed} / ${item.issuesTotal}`}
        />
      </div>

      {item.hypothesisText ? (
        <p className="line-clamp-3 text-sm leading-relaxed text-fg-secondary">
          {item.hypothesisText}
        </p>
      ) : (
        <p className="text-xs italic text-fg-tertiary">
          Гипотеза не была зафиксирована.
        </p>
      )}

      {item.learningSummary && (
        <div className="mt-auto rounded-md bg-bg-overlay px-3 py-2 text-xs text-fg-secondary">
          <span className="font-medium text-fg-primary">Что узнали: </span>
          <span className="line-clamp-2">{item.learningSummary}</span>
        </div>
      )}
    </Link>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-xs font-medium text-fg-secondary">
        {value}
      </div>
    </div>
  );
}

function computeDurationDays(
  startDate: string,
  endDate: string,
): number | null {
  const s = new Date(startDate).getTime();
  const e = new Date(endDate).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

function computeCompletedPercent(
  closed: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((closed / total) * 100)));
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function renderStatusBadge(item: SprintArchiveItemApi): React.ReactNode {
  if (item.status === 'in_progress') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
        <HelpCircle size={11} /> В процессе
      </span>
    );
  }
  if (item.status === 'cancelled') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
        Отменён
      </span>
    );
  }
  // completed
  if (item.confirmedHypothesis === true) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-chip-success-bg px-2 py-0.5 text-[10px] font-medium text-chip-success-fg">
        <CheckCircle2 size={11} /> Подтвердилась
      </span>
    );
  }
  if (item.confirmedHypothesis === false) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-chip-danger-bg px-2 py-0.5 text-[10px] font-medium text-chip-danger-fg">
        <XCircle size={11} /> Не подтвердилась
      </span>
    );
  }
  // null — нет данных hint'ов
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-tertiary">
      Завершён
    </span>
  );
}

// ─────────────────── states ────────────────────────────────────────────

function ArchiveSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-xl border border-border-subtle bg-bg-elevated shadow-card-soft"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-subtle bg-bg-elevated px-6 py-16 text-center shadow-card-soft">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-bg-overlay text-fg-tertiary">
        <Flag size={20} />
      </span>
      <div className="text-base font-semibold text-fg-primary">
        Архив пока пуст
      </div>
      <p className="max-w-md text-sm text-fg-tertiary">
        Когда вы завершите первый спринт, он попадёт сюда. По каждому
        будет видно, какую гипотезу вы проверяли и подтвердилась ли она.
      </p>
      <Link
        href="/sprints"
        className="mt-2 text-xs font-medium text-accent hover:underline"
      >
        К активным спринтам →
      </Link>
    </div>
  );
}

function LoadingOrNoOrg({
  loading,
  noOrg,
}: {
  loading: boolean;
  noOrg: boolean;
}) {
  if (loading) return <ArchiveSkeleton />;
  if (noOrg) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-elevated px-6 py-10 text-center text-sm text-fg-tertiary shadow-card-soft">
        Сначала выберите организацию.
      </div>
    );
  }
  return null;
}
