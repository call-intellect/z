'use client';

/**
 * SprintPreviewCard — карточка предпросмотра спринта справа от списка.
 *
 * Подтягивает топ-3 SprintHint и топ-3 задач без срока через дашборд / hints.
 *
 * Используется в:
 *   - desktop `/sprints` (правая колонка master-detail);
 *   - mobile `/sprints` (внутри Sheet'а).
 */
import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowRight,
  ClipboardList,
  Lightbulb,
  ListTodo,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';
import { cn } from '@/ui/shadcn/lib/utils';

import { sprintsApi } from '@/api/tracker/sprints.api';
import { sprintHintsApi } from '@/api/tracker/sprint-hints.api';
import {
  formatSprintDateRange,
  getScopeKindLabel,
  getStatusLabel,
  type DomainSprintListItem,
} from '@/domain/sprint';

interface SprintPreviewCardProps {
  orgId: string;
  sprint: DomainSprintListItem;
  /** Кнопка «Закрыть» — для mobile sheet. */
  onClose?: () => void;
}

/** Парные цвета scope-бэйджа: bg-chip-*-bg + text-chip-*-fg. */
function scopeBadgeClasses(kind: DomainSprintListItem['scope']['kind']): string {
  switch (kind) {
    case 'org':
      return 'bg-chip-sand-bg text-chip-sand-fg';
    case 'customer':
      return 'bg-chip-success-bg text-chip-success-fg';
    case 'vendor':
      return 'bg-chip-lavender-bg text-chip-lavender-fg';
    case 'person':
      return 'bg-chip-warning-bg text-chip-warning-fg';
    case 'department':
      return 'bg-chip-info-bg text-chip-info-fg';
    case 'project':
    default:
      return 'bg-accent text-accent-fg';
  }
}

/** Статус → цвет (парные токены). */
function statusClasses(status: DomainSprintListItem['status']): string {
  switch (status) {
    case 'active':
      return 'bg-chip-success-bg text-chip-success-fg';
    case 'completed':
      return 'bg-chip-sand-bg text-chip-sand-fg';
    case 'upcoming':
    default:
      return 'bg-chip-info-bg text-chip-info-fg';
  }
}

function statusIcon(status: DomainSprintListItem['status']) {
  switch (status) {
    case 'active':
      return PlayCircle;
    case 'completed':
      return PauseCircle;
    case 'upcoming':
    default:
      return Sparkles;
  }
}

export function SprintPreviewCard({
  orgId,
  sprint,
  onClose,
}: SprintPreviewCardProps) {
  // Топ-3 SprintHint
  const hintsSwr = useSWR(
    ['tracker.cycle.hints', orgId, sprint.id],
    () => sprintHintsApi.listByCycle(orgId, sprint.id),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  // Топ-3 задач без срока — берём из дашборда
  const dashboardSwr = useSWR(
    ['tracker.cycle.dashboard.preview', orgId, sprint.id],
    () => sprintsApi.dashboard(orgId, sprint.id),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const topHints = useMemo(
    () => (hintsSwr.data?.items ?? []).slice(0, 3),
    [hintsSwr.data],
  );
  const topTasksNoDue = useMemo(
    () => (dashboardSwr.data?.tasksWithoutDueDate ?? []).slice(0, 3),
    [dashboardSwr.data],
  );

  const percent = Math.round((sprint.progress.ratio || 0) * 100);
  const StatusIcon = statusIcon(sprint.status);

  return (
    <div
      className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:p-6"
      aria-label="Превью спринта"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-fg-tertiary">
            {sprint.projectIdentifier} · {sprint.projectName}
          </div>
          <h2 className="mt-0.5 text-lg font-semibold text-fg-primary md:text-xl">
            {sprint.name}
          </h2>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть превью"
            className="rounded-md p-1.5 text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {/* Scope + статус */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
            scopeBadgeClasses(sprint.scope.kind),
          )}
          title={`${getScopeKindLabel(sprint.scope.kind)} · ${sprint.scope.label}`}
        >
          {sprint.scope.label || getScopeKindLabel(sprint.scope.kind)}
        </span>
        {sprint.scope.isDeleted ? (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-chip-danger-bg px-2 py-0.5 text-xs font-medium text-chip-danger-fg"
            title="Связанная сущность удалена"
          >
            <Trash2 size={12} /> Удалён
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
            statusClasses(sprint.status),
          )}
        >
          <StatusIcon size={12} />
          {getStatusLabel(sprint.status)}
        </span>
      </div>

      {/* Даты */}
      <div className="text-xs text-fg-tertiary">
        {formatSprintDateRange(sprint.startDate, sprint.endDate)}
      </div>

      {/* Прогресс */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-secondary">Прогресс</span>
          <span className="font-medium text-fg-primary">
            {sprint.progress.completed} / {sprint.progress.total} ·{' '}
            <span className="text-fg-tertiary">{percent}%</span>
          </span>
        </div>
        <Progress value={percent} />
      </div>

      {/* Счётчики */}
      <div className="grid grid-cols-3 gap-2">
        <Counter
          icon={ListTodo}
          label="Задач"
          value={sprint.progress.total}
        />
        <Counter
          icon={Lightbulb}
          label="Подсказок"
          value={sprint.activeHintsCount}
          highlight={sprint.criticalHintsCount > 0}
        />
        <Counter
          icon={Video}
          label="Встреч"
          value={sprint.linkedMeetingsCount}
        />
      </div>

      {/* Топ-3 подсказок */}
      <section aria-label="Топ подсказок помощника">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
          <Lightbulb size={12} /> Подсказки помощника
        </h3>
        {hintsSwr.isLoading ? (
          <ListSkeleton lines={3} />
        ) : topHints.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Подсказок пока нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {topHints.map((h) => (
              <li
                key={h.id}
                className={cn(
                  'rounded-md border px-3 py-2 text-xs',
                  h.severity === 'critical'
                    ? 'border-chip-danger-bg bg-chip-danger-bg/50 text-chip-danger-fg'
                    : h.severity === 'warning'
                      ? 'border-chip-warning-bg bg-chip-warning-bg/50 text-chip-warning-fg'
                      : 'border-border-subtle bg-bg-elevated text-fg-secondary',
                )}
              >
                <div className="font-medium">{h.title}</div>
                {h.body ? (
                  <div className="mt-0.5 opacity-80">{h.body}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Топ-3 задач без срока */}
      <section aria-label="Задачи без срока">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
          <ClipboardList size={12} /> Задачи без срока
        </h3>
        {dashboardSwr.isLoading ? (
          <ListSkeleton lines={3} />
        ) : topTasksNoDue.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Все задачи имеют срок.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {topTasksNoDue.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs"
              >
                <span className="truncate text-fg-primary">{t.title}</span>
                <span className="shrink-0 text-fg-tertiary">
                  {t.identifier}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CTA */}
      <div className="mt-auto pt-2">
        <Button asChild className="w-full gap-2">
          <Link href={`/sprints/${encodeURIComponent(sprint.id)}`}>
            Открыть спринт
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  highlight = false,
}: {
  icon: typeof ListTodo;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2',
        highlight
          ? 'border-chip-danger-bg bg-chip-danger-bg/50'
          : 'border-border-subtle bg-bg-elevated',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-fg-tertiary">
        <Icon size={12} />
        {label}
      </div>
      <div
        className={cn(
          'text-lg font-semibold',
          highlight ? 'text-chip-danger-fg' : 'text-fg-primary',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ListSkeleton({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
        />
      ))}
    </div>
  );
}
