'use client';

/**
 * OrgBoard — кросс-проектная канбан-доска «Все проекты» (рабочий стол «Задачи»).
 *
 * Чем отличается от `Board.tsx`:
 *   - Board — доска ОДНОГО проекта: колонки = статусы (`TrackerState`) проекта,
 *     drag-n-drop → `issuesApi.transition({ stateId })` (конкретный статус).
 *   - OrgBoard — доска ВСЕХ проектов сразу: у задач разные проекты, поэтому
 *     общих статусов нет. Колонки = 5 универсальных КАТЕГОРИЙ
 *     (`IssueStateCategory`: backlog/unstarted/started/completed/cancelled).
 *     Drag-n-drop карточки в колонку → `issuesApi.transitionToCategory`, и
 *     backend сам резолвит конкретный статус по (projectId задачи, category).
 *
 * Упрощения относительно Board: нет reorder/`useSortable` (порядок внутри
 * колонки между проектами не имеет смысла), нет QuickAdd в колонках (создание
 * задачи — на уровне рабочего стола, Фаза 5).
 *
 * Оптимистика: `useOrgIssues().mutate` — это просто ре-валидация без
 * `optimisticData`, поэтому моментальный «прыжок» карточки делаем локальным
 * override-стейтом `pendingMoves` (issueId → целевая категория) до прихода
 * свежих данных; на ошибке override снимается и карточка возвращается.
 *
 * Доступность: keyboard sensor (стрелки/пробел), touch sensor с long-press,
 * чтобы не блокировать нативный скролл.
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
import { toast } from 'sonner';

import { useOrgIssues } from '@/hooks/tracker/useOrgIssues';
import { issuesApi, type ListOrgIssuesRequest } from '@/api/tracker/issues.api';
import { humanizeApiError } from '@/api/api-error';
import {
  ISSUE_STATE_CATEGORY_LABELS,
  ISSUE_STATE_CATEGORY_VALUES,
  type Issue,
  type IssueStateCategory,
} from '@/domain/tracker';
import { IssueCard } from './IssueCard';
import { cn } from '@/ui/shadcn/lib/utils';

// ─── Резолвер колонки ───────────────────────────────────────────────────────

const CATEGORY_SET = new Set<IssueStateCategory>(ISSUE_STATE_CATEGORY_VALUES);

/**
 * В какую из 5 колонок-категорий попадает задача на доске «Все проекты».
 * Гарантирует ровно одну из 5 (карточка не теряется): берём `stateCategory`,
 * если это одна из 5; иначе фолбэк по `isCompleted`/`archivedAt`; иначе backlog.
 */
export function orgBoardColumnFor(
  issue: Pick<Issue, 'stateCategory' | 'isCompleted' | 'archivedAt'>,
): IssueStateCategory {
  const c = issue.stateCategory;
  if (c && CATEGORY_SET.has(c)) return c;
  if (issue.isCompleted) return 'completed';
  if (issue.archivedAt) return 'cancelled';
  return 'backlog';
}

// ─── Идентификаторы drag-and-drop ───────────────────────────────────────────
// dnd-kit требует string|number id. Префиксы — чтобы не было коллизии card↔col.

const COL_PREFIX = 'col:';
const CARD_PREFIX = 'card:';
const cardDndId = (issueId: string): string => `${CARD_PREFIX}${issueId}`;
const colDndId = (category: IssueStateCategory): string => `${COL_PREFIX}${category}`;
const parseColId = (id: string): IssueStateCategory | null => {
  if (!id.startsWith(COL_PREFIX)) return null;
  const cat = id.slice(COL_PREFIX.length) as IssueStateCategory;
  return CATEGORY_SET.has(cat) ? cat : null;
};
const parseCardId = (id: string): string | null =>
  id.startsWith(CARD_PREFIX) ? id.slice(CARD_PREFIX.length) : null;

export function OrgBoard({
  orgId,
  req,
}: {
  orgId: string;
  /** Фильтры сквозного списка (проект/исполнитель/приоритет/поиск). */
  req?: ListOrgIssuesRequest;
}) {
  const { issues, isLoading, error, mutate } = useOrgIssues(orgId, req);

  // Локальная оптимистика: issueId → целевая категория (карточка «прыгает»
  // мгновенно до прихода ре-валидированных данных).
  const [pendingMoves, setPendingMoves] = useState<
    Map<string, IssueStateCategory>
  >(new Map());
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  // Sensors: pointer для мыши, touch с задержкой 200ms (чтобы вертикальный
  // скролл по странице работал), keyboard для a11y.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const issuesById = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of issues) m.set(i.id, i);
    return m;
  }, [issues]);

  /** Эффективная колонка задачи с учётом оптимистичного override. */
  const columnOf = useCallback(
    (issue: Issue): IssueStateCategory =>
      pendingMoves.get(issue.id) ?? orgBoardColumnFor(issue),
    [pendingMoves],
  );

  // Группировка задач по 5 колонкам-категориям.
  const byColumn = useMemo(() => {
    const result = new Map<IssueStateCategory, Issue[]>();
    for (const cat of ISSUE_STATE_CATEGORY_VALUES) result.set(cat, []);
    for (const issue of issues) {
      const cat = pendingMoves.get(issue.id) ?? orgBoardColumnFor(issue);
      result.get(cat)?.push(issue);
    }
    return result;
  }, [issues, pendingMoves]);

  const activeIssue = activeIssueId
    ? issuesById.get(activeIssueId) ?? null
    : null;

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
      if (!issueId) return;

      const issue = issuesById.get(issueId);
      if (!issue) return;

      // Целевую категорию определяем по тому, куда приземлились:
      //   - col:<cat>        → прямо эта категория;
      //   - card:<otherId>   → категория колонки той карточки.
      const overColCat = parseColId(String(over.id));
      const overCardId = parseCardId(String(over.id));
      let targetCat: IssueStateCategory | null = overColCat;
      if (!targetCat && overCardId) {
        const overIssue = issuesById.get(overCardId);
        if (overIssue) targetCat = columnOf(overIssue);
      }
      if (!targetCat) return;

      // Уже в этой колонке — переход не нужен.
      if (columnOf(issue) === targetCat) return;

      // Оптимистично «двигаем» карточку.
      setPendingMoves((prev) => new Map(prev).set(issueId, targetCat));
      try {
        await issuesApi.transitionToCategory(orgId, issueId, targetCat);
        // Ре-валидация: в свежих данных stateCategory уже = targetCat.
        await mutate();
      } catch (err) {
        toast.error(
          `Не удалось перевести задачу: ${humanizeApiError(err, 'попробуйте ещё раз')}`,
          { duration: 5000 },
        );
        console.error(err);
      } finally {
        // Успех: данные уже верны, override лишний. Ошибка: снимаем override —
        // карточка возвращается в исходную колонку.
        setPendingMoves((prev) => {
          const m = new Map(prev);
          m.delete(issueId);
          return m;
        });
      }
    },
    [issuesById, orgId, mutate, columnOf],
  );

  // ─── Loading / error ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ISSUE_STATE_CATEGORY_VALUES.map((cat) => (
          <OrgBoardColumnSkeleton
            key={cat}
            title={ISSUE_STATE_CATEGORY_LABELS[cat]}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Не удалось загрузить задачи. Обнови страницу.
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
        {ISSUE_STATE_CATEGORY_VALUES.map((cat) => (
          <OrgBoardColumn
            key={cat}
            category={cat}
            issues={byColumn.get(cat) ?? []}
            pendingIssueIds={pendingMoves}
          />
        ))}
      </div>

      {/* Floating overlay над курсором/пальцем — карточка, которую тащим. */}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <IssueCard issue={activeIssue} compact /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Колонка ────────────────────────────────────────────────────────────────

function OrgBoardColumn({
  category,
  issues,
  pendingIssueIds,
}: {
  category: IssueStateCategory;
  issues: Issue[];
  /** issueId → целевая категория (для индикации «в процессе перевода»). */
  pendingIssueIds: Map<string, IssueStateCategory>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colDndId(category) });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 transition-colors md:w-80',
        isOver && 'bg-bg-overlay/80 ring-2 ring-accent/60',
      )}
      data-state-category={category}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs uppercase tracking-wider text-fg-secondary">
          {ISSUE_STATE_CATEGORY_LABELS[category]}
        </span>
        <span className="text-[11px] text-fg-tertiary">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {issues.map((issue) => (
          <OrgBoardCard
            key={issue.id}
            issue={issue}
            pending={pendingIssueIds.has(issue.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OrgBoardColumnSkeleton({ title }: { title: string }) {
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
// В отличие от Board (там useSortable для reorder), здесь только useDraggable:
// порядок внутри колонки между разными проектами не имеет смысла.

function OrgBoardCard({
  issue,
  pending,
}: {
  issue: Issue;
  pending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useDraggable({ id: cardDndId(issue.id) });

  // Как в Board.tsx — простой translate3d (без `@dnd-kit/utilities`).
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
