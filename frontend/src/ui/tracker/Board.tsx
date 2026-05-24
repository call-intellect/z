'use client';

/**
 * Board — канбан-доска проекта с drag-and-drop переходом задач между
 * статусами (`IssueState`).
 *
 * Колонки = `TrackerState` проекта (грузятся через `useStates`). Если в
 * проекте нет статусов (старый проект до Sprint 3), фолбэк — 5 колонок
 * по category и группировка по `isCompleted` (как в Phase 2).
 *
 * Drag-and-drop:
 *   - `@dnd-kit/core` `DndContext` оборачивает board.
 *   - Каждая колонка — droppable (`useDroppable`) c id `col:<stateId>`.
 *   - Каждая карточка — draggable (`useDraggable`) c id `card:<issueId>`.
 *   - На `onDragEnd`: если карточка приземлилась в колонку с другим stateId
 *     → PATCH `/api/v1/issues/:id/transitions` с новым stateId.
 *   - Optimistic update: сразу мутируем SWR-кэш, на ошибке `mutate()`
 *     ре-валидирует с сервера (откат).
 *
 * Доступность: keyboard sensor (`KeyboardSensor`) поддерживает стрелки и
 * пробел; для тач-устройств — `TouchSensor` с активацией по long-press, чтобы
 * не блокировать нативный скролл.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useSWRConfig } from 'swr';

import { useIssues } from '@/hooks/tracker/useIssues';
import { useStates } from '@/hooks/tracker/useStates';
import { issuesApi } from '@/api/tracker/issues.api';
import {
  ISSUE_STATE_CATEGORY_LABELS,
  ISSUE_STATE_CATEGORY_VALUES,
  type Issue,
  type IssueApi,
  type IssueStateCategory,
  type ListIssuesResponseApi,
} from '@/domain/tracker';
import { IssueCard } from './IssueCard';
import { QuickAdd } from './QuickAdd';
import { cn } from '@/ui/shadcn/lib/utils';

// ─── Идентификаторы drag-and-drop ───────────────────────────────────────────
// dnd-kit требует string|number id. Префиксы — чтобы не было коллизии card↔col.

const COL_PREFIX = 'col:';
const CARD_PREFIX = 'card:';
const cardId = (issueId: string): string => `${CARD_PREFIX}${issueId}`;
const colId = (stateId: string): string => `${COL_PREFIX}${stateId}`;
const parseColId = (id: string): string | null =>
  id.startsWith(COL_PREFIX) ? id.slice(COL_PREFIX.length) : null;
const parseCardId = (id: string): string | null =>
  id.startsWith(CARD_PREFIX) ? id.slice(CARD_PREFIX.length) : null;

// ─── Fallback резолвер category, когда states не загрузились ────────────────

function defaultResolveCategory(issue: Issue): IssueStateCategory {
  if (issue.isCompleted) return 'completed';
  if (issue.archivedAt) return 'cancelled';
  return 'unstarted';
}

export function Board({
  orgId,
  projectId,
  resolveCategory = defaultResolveCategory,
}: {
  orgId: string;
  projectId: string;
  resolveCategory?: (issue: Issue) => IssueStateCategory;
}) {
  const { issues, isLoading, error, mutate } = useIssues(orgId, projectId, {
    limit: 100,
  });
  const { states, isLoading: statesLoading } = useStates(orgId, projectId);
  const { mutate: globalMutate } = useSWRConfig();
  const [creating, setCreating] = useState(false);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [pendingTransitionIssueId, setPendingTransitionIssueId] = useState<
    string | null
  >(null);

  // Sensors: pointer для мыши, touch с задержкой 200ms для тач (чтобы
  // вертикальный скролл по странице работал), keyboard для a11y.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleCreate = useCallback(
    async (title: string) => {
      setCreating(true);
      try {
        await issuesApi.create(orgId, projectId, { title });
        await mutate();
      } finally {
        setCreating(false);
      }
    },
    [orgId, projectId, mutate],
  );

  const issuesById = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of issues) m.set(i.id, i);
    return m;
  }, [issues]);

  const activeIssue = activeIssueId ? issuesById.get(activeIssueId) ?? null : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const issueId = parseCardId(String(event.active.id));
    if (issueId) setActiveIssueId(issueId);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveIssueId(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveIssueId(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = parseCardId(String(active.id));
      const targetStateId = parseColId(String(over.id));
      if (!issueId || !targetStateId) return;

      const issue = issuesById.get(issueId);
      if (!issue) return;

      // Если перетащили в ту же колонку — переход не нужен.
      if (issue.stateId === targetStateId) return;

      // Optimistic update: подменяем stateId в локальном кэше.
      setPendingTransitionIssueId(issueId);
      try {
        await mutate(
          async () => {
            // Сервер — источник правды для completedAt/updatedAt.
            await issuesApi.transition(orgId, issueId, {
              stateId: targetStateId,
            });
            // Возврат undefined → SWR сам сделает ревалидацию по ключу.
            return undefined;
          },
          {
            optimisticData: (
              current: ListIssuesResponseApi | undefined,
            ): ListIssuesResponseApi => {
              // SWR требует non-undefined результат — если кэш пустой,
              // возвращаем «пустой» ответ (этого случая не должно быть, мы
              // редактируем уже отрендеренный список).
              if (!current) {
                return { items: [], total: 0, page: 1, limit: 100 };
              }
              return {
                ...current,
                items: current.items.map(
                  (it: IssueApi): IssueApi =>
                    it.id === issueId ? { ...it, stateId: targetStateId } : it,
                ),
              };
            },
            rollbackOnError: true,
            revalidate: true,
            populateCache: false,
          },
        );
        // Раз stateId сменился — связанные ключи (single issue, activity)
        // тоже устарели. Триггерим ре-валидацию по префиксам.
        void globalMutate(
          (key: unknown) =>
            Array.isArray(key) &&
            typeof key[0] === 'string' &&
            (key[0] === 'tracker.issue' ||
              key[0] === 'tracker.issue.activity' ||
              key[0] === 'me.inbox'),
          undefined,
          { revalidate: true },
        );
      } catch {
        // SWR уже откатил `optimisticData` благодаря rollbackOnError.
        // TODO: показать toast «Не удалось перенести задачу».
      } finally {
        setPendingTransitionIssueId(null);
      }
    },
    [issuesById, orgId, mutate, globalMutate],
  );

  // ─── States: если backend ещё не отдал states или их нет — fallback на
  // 5 виртуальных колонок по category. В этом режиме drag-and-drop отключён
  // (нет реального stateId для transition).
  const columns = useMemo<BoardColumnSpec[]>(() => {
    if (states.length > 0) {
      return states.map((s) => ({
        kind: 'state' as const,
        key: s.id,
        stateId: s.id,
        title: s.name,
        category: s.category,
        color: s.color,
        accept: true,
      }));
    }
    return ISSUE_STATE_CATEGORY_VALUES.map((cat) => ({
      kind: 'category' as const,
      key: cat,
      stateId: null,
      title: ISSUE_STATE_CATEGORY_LABELS[cat],
      category: cat,
      color: null,
      accept: false,
    }));
  }, [states]);

  // Группируем задачи по колонке. Если есть states — по stateId; иначе по
  // category через resolver.
  const byColumn = useMemo(() => {
    const result = new Map<string, Issue[]>();
    for (const col of columns) result.set(col.key, []);
    for (const issue of issues) {
      if (states.length > 0) {
        const target = issue.stateId;
        if (target && result.has(target)) {
          result.get(target)!.push(issue);
          continue;
        }
        // Задача без stateId или с неизвестным stateId — кидаем в backlog/первую.
        const fallback =
          columns.find((c) => c.category === 'backlog')?.key ?? columns[0]?.key;
        if (fallback) result.get(fallback)?.push(issue);
      } else {
        const cat = resolveCategory(issue);
        const target = columns.find((c) => c.category === cat)?.key;
        if (target) result.get(target)?.push(issue);
      }
    }
    return result;
  }, [columns, issues, states.length, resolveCategory]);

  // ─── States: loading / error ─────────────────────────────────────────────
  if (isLoading || statesLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ISSUE_STATE_CATEGORY_VALUES.map((cat) => (
          <BoardColumnSkeleton key={cat} title={ISSUE_STATE_CATEGORY_LABELS[cat]} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Не удалось загрузить задачи проекта. Обнови страницу.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const list = byColumn.get(col.key) ?? [];
          const showQuickAdd =
            col.category === 'backlog' || col.category === 'unstarted';
          return (
            <BoardColumn
              key={col.key}
              column={col}
              issues={list}
              pendingIssueId={pendingTransitionIssueId}
              quickAdd={
                showQuickAdd ? (
                  <QuickAdd
                    onSubmit={handleCreate}
                    buttonLabel="Задача"
                    placeholder="Что нужно сделать?"
                  />
                ) : null
              }
              disabled={creating}
            />
          );
        })}
      </div>

      {/* Floating overlay над курсором/пальцем — карточка, которую тащим. */}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <IssueCard issue={activeIssue} compact /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Колонка ────────────────────────────────────────────────────────────────

interface BoardColumnSpec {
  kind: 'state' | 'category';
  key: string;
  /** Реальный stateId (если kind=state). Для fallback (category) — null. */
  stateId: string | null;
  title: string;
  category: IssueStateCategory;
  color: string | null;
  /** Принимает ли колонка drop (только когда есть реальный stateId). */
  accept: boolean;
}

function BoardColumn({
  column,
  issues,
  pendingIssueId,
  quickAdd,
  disabled,
}: {
  column: BoardColumnSpec;
  issues: Issue[];
  pendingIssueId: string | null;
  quickAdd?: React.ReactNode;
  disabled?: boolean;
}) {
  // useDroppable вызывается всегда (хуки в условиях запрещены), но эффективен
  // только когда column.accept === true.
  const droppableId = column.stateId
    ? colId(column.stateId)
    : `col-fallback:${column.key}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    disabled: !column.accept,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 transition-colors md:w-80',
        column.accept && isOver && 'bg-bg-overlay/80 ring-2 ring-accent/60',
      )}
      aria-disabled={disabled}
      data-state-id={column.stateId ?? undefined}
      data-state-category={column.category}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-fg-secondary">
          {column.color && (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: column.color }}
              aria-hidden
            />
          )}
          {column.title}
        </span>
        <span className="text-[11px] text-fg-tertiary">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {issues.map((issue) => (
          <DraggableIssueCard
            key={issue.id}
            issue={issue}
            disabled={!column.accept}
            pending={pendingIssueId === issue.id}
          />
        ))}
      </div>
      {quickAdd}
    </div>
  );
}

function BoardColumnSkeleton({ title }: { title: string }) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 md:w-80">
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs uppercase tracking-wider text-fg-secondary">
          {title}
        </span>
        <span className="text-[11px] text-fg-tertiary">…</span>
      </div>
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Draggable wrapper для карточки ─────────────────────────────────────────

function DraggableIssueCard({
  issue,
  disabled,
  pending,
}: {
  issue: Issue;
  disabled?: boolean;
  pending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useDraggable({
      id: cardId(issue.id),
      disabled,
    });

  // Перевод в CSS — без `@dnd-kit/utilities` зависимости, чтобы не тянуть
  // лишний импорт (хотя пакет установлен). Простой translate3d.
  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0 : 1, // оригинал прячем — рисует DragOverlay
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'touch-none', // выключаем нативный скролл во время grab
        pending && 'opacity-60',
      )}
      aria-grabbed={isDragging}
    >
      <IssueCard issue={issue} />
    </div>
  );
}
