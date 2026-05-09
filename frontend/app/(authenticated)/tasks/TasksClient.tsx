'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { destinationsApi, type DestinationApi } from '@/api/destinations.api';
import {
  tasksApi,
  type TaskApi,
  type TaskStatus,
} from '@/api/tasks.api';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { Input } from '@/ui/shadcn/input';
import { cn } from '@/ui/shadcn/lib/utils';

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  done: 'Готова',
  cancelled: 'Отменена',
};

const STATUS_FILTER_ORDER: TaskStatus[] = ['open', 'in_progress', 'done', 'cancelled'];

type Group = 'overdue' | 'today' | 'week' | 'later' | 'no_due';

const GROUP_LABEL: Record<Group, string> = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  week: 'На неделе',
  later: 'Позже',
  no_due: 'Без срока',
};

const GROUP_ORDER: Group[] = ['overdue', 'today', 'week', 'later', 'no_due'];

function classifyDue(dueIso: string | null): Group {
  if (!dueIso) return 'no_due';
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return 'no_due';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfNextWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (due < startOfToday) return 'overdue';
  if (due < startOfTomorrow) return 'today';
  if (due < startOfNextWeek) return 'week';
  return 'later';
}

function formatDue(dueIso: string | null): string {
  if (!dueIso) return '—';
  const d = new Date(dueIso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function toDateInputValue(dueIso: string | null): string {
  if (!dueIso) return '';
  const d = new Date(dueIso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  // Прибавляем `T00:00:00.000Z` чтобы получить корректный ISO с offset.
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

export function TasksClient() {
  const { addToast } = useToast();
  const [tasks, setTasks] = useState<TaskApi[]>([]);
  const [destinations, setDestinations] = useState<DestinationApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterStatuses, setFilterStatuses] = useState<TaskStatus[]>(['open', 'in_progress']);
  const [thisWeekOnly, setThisWeekOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dueBefore = thisWeekOnly
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
      const res = await tasksApi.list({
        status: filterStatuses.length > 0 ? filterStatuses : undefined,
        dueBefore,
        q: search.trim() || undefined,
        limit: 100,
      });
      setTasks(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить задачи');
    } finally {
      setLoading(false);
    }
  }, [filterStatuses, thisWeekOnly, search]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    destinationsApi
      .list()
      .then((res) => setDestinations(res.items))
      .catch(() => {
        // тихо — destinations опциональны для базового просмотра задач
      });
  }, []);

  const grouped = useMemo(() => {
    const map: Record<Group, TaskApi[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
      no_due: [],
    };
    for (const t of tasks) {
      map[classifyDue(t.dueDate)].push(t);
    }
    return map;
  }, [tasks]);

  const toggleStatus = useCallback((s: TaskStatus) => {
    setFilterStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  const handleUpdate = useCallback(
    async (id: string, patch: Parameters<typeof tasksApi.update>[1]) => {
      try {
        const updated = await tasksApi.update(id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiError ? e.message : 'Не удалось обновить задачу',
        });
      }
    },
    [addToast],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await tasksApi.remove(id);
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiError ? e.message : 'Не удалось удалить задачу',
        });
      }
    },
    [addToast],
  );

  const handleSend = useCallback(
    async (id: string, destinationId: string) => {
      try {
        await tasksApi.send(id, { destinationId });
        addToast({ type: 'success', message: 'Отправлено' });
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiError ? e.message : 'Не удалось отправить',
        });
      }
    },
    [addToast],
  );

  const handleBulk = useCallback(
    async (action: 'mark_done' | 'delete') => {
      if (selectedIds.size === 0) return;
      try {
        const ids = Array.from(selectedIds);
        const res = await tasksApi.bulk({ ids, action });
        addToast({
          type: 'success',
          message: `Обновлено: ${res.affected}`,
        });
        setSelectedIds(new Set());
        await fetchTasks();
      } catch (e) {
        addToast({
          type: 'error',
          message: e instanceof ApiError ? e.message : 'Bulk-операция не удалась',
        });
      }
    },
    [addToast, fetchTasks, selectedIds],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Задачи
          </h1>
          <p className="text-sm text-fg-secondary">
            Все задачи из ваших встреч в одном месте.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchTasks()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Обновить
        </Button>
      </header>

      {/* Фильтры */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STATUS_FILTER_ORDER.map((s) => {
          const active = filterStatuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-accent-border bg-accent-muted text-accent'
                  : 'border-border-subtle bg-bg-card text-fg-secondary hover:bg-bg-overlay',
              )}
            >
              {STATUS_LABEL[s]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setThisWeekOnly((v) => !v)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            thisWeekOnly
              ? 'border-accent-border bg-accent-muted text-accent'
              : 'border-border-subtle bg-bg-card text-fg-secondary hover:bg-bg-overlay',
          )}
        >
          Срок: на этой неделе
        </button>
        <div className="relative ml-auto w-full max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию"
            className="pl-8"
          />
        </div>
      </div>

      {/* Bulk-toolbar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-accent-border bg-accent-muted/40 px-3 py-2 text-sm">
          <span className="text-fg-primary">Выбрано: {selectedIds.size}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleBulk('mark_done')}>
              Отметить выполненными
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void handleBulk('delete')}>
              Удалить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Снять выделение
            </Button>
          </div>
        </div>
      )}

      {/* Состояния */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Загружаем задачи...
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card/40 p-10 text-center">
          <p className="text-sm text-fg-secondary">
            Задачи появятся здесь после прохождения встреч.
          </p>
          <Button asChild className="mt-4" size="sm">
            <Link href="/meetings/create">Создать встречу</Link>
          </Button>
        </div>
      )}

      {/* Группы */}
      {!loading &&
        !error &&
        tasks.length > 0 &&
        GROUP_ORDER.map((group) => {
          const items = grouped[group];
          if (items.length === 0) return null;
          return (
            <section key={group} className="mb-6">
              <h2
                className={cn(
                  'sticky top-0 z-10 mb-2 -mx-2 bg-bg-base/95 px-2 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-glass',
                  group === 'overdue' ? 'text-danger' : 'text-fg-tertiary',
                )}
              >
                {GROUP_LABEL[group]} · {items.length}
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      destinations={destinations}
                      selected={selectedIds.has(task.id)}
                      onToggleSelect={() => toggleSelected(task.id)}
                      onUpdate={(patch) => handleUpdate(task.id, patch)}
                      onDelete={() => handleDelete(task.id)}
                      onSend={(destId) => handleSend(task.id, destId)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function TaskCard({
  task,
  destinations,
  selected,
  onToggleSelect,
  onUpdate,
  onDelete,
  onSend,
}: {
  task: TaskApi;
  destinations: DestinationApi[];
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (patch: Parameters<typeof tasksApi.update>[1]) => Promise<void>;
  onDelete: () => Promise<void>;
  onSend: (destinationId: string) => Promise<void>;
}) {
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [assigneeEditing, setAssigneeEditing] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState(task.assigneeRaw ?? '');
  const [dueDraft, setDueDraft] = useState(toDateInputValue(task.dueDate));
  const [duePopoverOpen, setDuePopoverOpen] = useState(false);

  const isDone = task.status === 'done';
  const lowConfidence = task.confidence !== null && task.confidence < 0.7;

  const commitTitle = async () => {
    setTitleEditing(false);
    if (titleDraft.trim() && titleDraft.trim() !== task.title) {
      await onUpdate({ title: titleDraft.trim() });
    } else {
      setTitleDraft(task.title);
    }
  };

  const commitAssignee = async () => {
    setAssigneeEditing(false);
    const next = assigneeDraft.trim();
    if (next !== (task.assigneeRaw ?? '')) {
      await onUpdate({ assigneeRaw: next || null });
    }
  };

  const commitDue = async () => {
    setDuePopoverOpen(false);
    const iso = fromDateInputValue(dueDraft);
    if (iso !== task.dueDate) {
      await onUpdate({ dueDate: iso });
    }
  };

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border p-3 transition-colors',
        selected
          ? 'border-accent bg-accent-muted/30'
          : 'border-border-subtle bg-bg-card hover:border-border',
        isDone && 'opacity-60',
      )}
    >
      {/* Bulk-checkbox slim */}
      <Checkbox
        checked={selected}
        onCheckedChange={onToggleSelect}
        className="mt-1.5"
        aria-label="Выбрать"
      />

      {/* Status checkbox (toggle done) */}
      <button
        type="button"
        onClick={() =>
          void onUpdate({ status: isDone ? 'open' : 'done' })
        }
        className={cn(
          'mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors',
          isDone
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-border-strong hover:border-accent',
        )}
        aria-label={isDone ? 'Вернуть в работу' : 'Отметить выполненной'}
      >
        {isDone && <span className="block h-2 w-2 rounded-full bg-accent-fg" />}
      </button>

      <div className="min-w-0 flex-1">
        {/* Title */}
        {titleEditing ? (
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitTitle();
              if (e.key === 'Escape') {
                setTitleDraft(task.title);
                setTitleEditing(false);
              }
            }}
            className="h-7 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setTitleEditing(true)}
            className={cn(
              'block w-full text-left text-sm font-medium',
              isDone ? 'text-fg-tertiary line-through' : 'text-fg-primary',
            )}
          >
            {task.title}
          </button>
        )}

        {task.description && (
          <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">
            {task.description}
          </p>
        )}

        {/* Метаданные */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {/* Assignee */}
          {assigneeEditing ? (
            <Input
              autoFocus
              value={assigneeDraft}
              onChange={(e) => setAssigneeDraft(e.target.value)}
              onBlur={() => void commitAssignee()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitAssignee();
                if (e.key === 'Escape') {
                  setAssigneeDraft(task.assigneeRaw ?? '');
                  setAssigneeEditing(false);
                }
              }}
              placeholder="кому?"
              className="h-6 w-32 text-xs"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAssigneeEditing(true)}
              className="text-fg-tertiary hover:text-fg-primary"
            >
              {task.assigneeRaw ? `@ ${task.assigneeRaw}` : '+ ответственный'}
            </button>
          )}

          {/* Due */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDuePopoverOpen((v) => !v)}
              className="text-fg-tertiary hover:text-fg-primary"
            >
              {task.dueDate ? `срок: ${formatDue(task.dueDate)}` : '+ срок'}
            </button>
            {duePopoverOpen && (
              <div className="absolute left-0 top-6 z-20 flex items-center gap-1 rounded-md border border-border-subtle bg-bg-card p-1.5 shadow-modal">
                <Input
                  type="date"
                  value={dueDraft}
                  onChange={(e) => setDueDraft(e.target.value)}
                  className="h-7 w-36 text-xs"
                  autoFocus
                />
                <Button size="sm" onClick={() => void commitDue()}>
                  Ок
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDuePopoverOpen(false)}>
                  ×
                </Button>
              </div>
            )}
          </div>

          {/* Link to meeting */}
          <Link
            href={`/meetings/${encodeURIComponent(task.meetingId)}/result`}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink size={11} /> Встреча
          </Link>

          {/* Confidence badge */}
          {lowConfidence && (
            <Badge variant="warning" className="text-[10px]">
              Низкая уверенность
            </Badge>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost">
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Статус</DropdownMenuLabel>
            {STATUS_FILTER_ORDER.map((s) => (
              <DropdownMenuItem
                key={s}
                onSelect={() => void onUpdate({ status: s })}
                className={cn(task.status === s && 'font-medium text-accent')}
              >
                {STATUS_LABEL[s]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1">
              <Send size={12} /> Отправить в…
            </DropdownMenuLabel>
            {destinations.length === 0 && (
              <DropdownMenuItem disabled>Нет destinations</DropdownMenuItem>
            )}
            {destinations.map((d) => (
              <DropdownMenuItem
                key={d.id}
                onSelect={() => void onSend(d.id)}
                className="flex items-center gap-2"
              >
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {d.type.replace('_webhook', '')}
                </Badge>
                <span className="truncate">{d.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void onDelete()}
              className="text-danger focus:text-danger"
            >
              <Trash2 size={12} />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
