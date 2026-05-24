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
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useSWRConfig } from 'swr';

import { useIssues } from '@/hooks/tracker/useIssues';
import { useStates } from '@/hooks/tracker/useStates';
import { issuesApi } from '@/api/tracker/issues.api';
import { useToast } from '@/contexts/toast-context';
import {
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATE_CATEGORY_LABELS,
  ISSUE_STATE_CATEGORY_VALUES,
  parseIssuePriority,
  type Issue,
  type IssueApi,
  type IssueAiSuggestionsApi,
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
  const { addToast } = useToast();
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
        // Phase 3 part C: просим backend дополнить ответ AI-подсказками.
        // Они опциональны (только если confidence ≥ 0.7 на стороне сервера).
        const created = await issuesApi.create(orgId, projectId, {
          title,
          inferSuggestions: true,
        });
        await mutate();
        // Если backend вернул aiSuggestions с достаточной уверенностью —
        // показываем toast с действием Accept. Логика поднята в отдельную
        // функцию, чтобы не загромождать handleCreate.
        if (created.aiSuggestions) {
          showAiSuggestionsToasts(created, created.aiSuggestions, {
            orgId,
            mutateBoard: mutate,
            addToast,
          });
        }
      } finally {
        setCreating(false);
      }
    },
    [orgId, projectId, mutate, addToast],
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
      if (!issueId) return;

      const issue = issuesById.get(issueId);
      if (!issue) return;

      const overCardId = parseCardId(String(over.id));
      const overColId = parseColId(String(over.id));

      // Случай 1: dropped на другую карточку — это reorder/перенос на её позицию.
      // Вычисляем целевую колонку по тому, в какой колонке находится карточка-цель.
      if (overCardId && overCardId !== issueId) {
        const overIssue = issuesById.get(overCardId);
        if (!overIssue) return;
        const targetStateIdFromCard = overIssue.stateId;
        // Reorder внутри той же колонки — обновляем sortOrder.
        if (
          issue.stateId === targetStateIdFromCard &&
          targetStateIdFromCard
        ) {
          setPendingTransitionIssueId(issueId);
          try {
            await mutate(
              async () => {
                // Считаем новый порядок локально в той же колонке.
                const sameCol = issues
                  .filter((i) => i.stateId === targetStateIdFromCard)
                  .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                const ids = sameCol.map((i) => i.id);
                const fromIdx = ids.indexOf(issueId);
                const toIdx = ids.indexOf(overCardId);
                if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
                  return undefined;
                }
                const reorderedIds = arrayMove(ids, fromIdx, toIdx);
                const newSortOrder = reorderedIds.indexOf(issueId) * 1000;
                try {
                  await issuesApi.reorder(orgId, issueId, newSortOrder);
                } catch (err) {
                  // 404 — endpoint ещё нет: молча оставляем оптимистичный UI
                  // до следующего refresh. Любая другая ошибка — пробрасываем.
                  const status =
                    err && typeof err === 'object' && 'status' in err
                      ? Number((err as { status?: unknown }).status)
                      : null;
                  if (status !== 404) throw err;
                }
                return undefined;
              },
              {
                optimisticData: (
                  current: ListIssuesResponseApi | undefined,
                ): ListIssuesResponseApi => {
                  if (!current) {
                    return { items: [], total: 0, page: 1, limit: 100 };
                  }
                  const sameColItems = current.items
                    .filter((it) => it.stateId === targetStateIdFromCard)
                    .sort(
                      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
                    );
                  const ids = sameColItems.map((it) => it.id);
                  const fromIdx = ids.indexOf(issueId);
                  const toIdx = ids.indexOf(overCardId);
                  if (fromIdx < 0 || toIdx < 0) return current;
                  const reorderedIds = arrayMove(ids, fromIdx, toIdx);
                  const orderMap = new Map<string, number>();
                  reorderedIds.forEach((id, idx) => orderMap.set(id, idx * 1000));
                  return {
                    ...current,
                    items: current.items.map((it: IssueApi): IssueApi => {
                      const nextOrder = orderMap.get(it.id);
                      return nextOrder !== undefined
                        ? { ...it, sortOrder: nextOrder }
                        : it;
                    }),
                  };
                },
                rollbackOnError: true,
                revalidate: false,
                populateCache: false,
              },
            );
          } catch (err) {
            addToast({
              type: 'error',
              message: `Не удалось переставить задачу: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
              durationMs: 5000,
            });
            console.error(err);
          } finally {
            setPendingTransitionIssueId(null);
          }
          return;
        }
        // Если карточка дропнута на карточку из ДРУГОЙ колонки — обрабатываем
        // как переход в эту колонку (логика ниже).
        if (targetStateIdFromCard && issue.stateId !== targetStateIdFromCard) {
          await runTransition(issueId, targetStateIdFromCard);
        }
        return;
      }

      const targetStateId = overColId;
      if (!targetStateId) return;

      // Если перетащили в ту же колонку без конкретной target-карточки —
      // переход не нужен (это просто промах мимо других карточек).
      if (issue.stateId === targetStateId) return;

      await runTransition(issueId, targetStateId);
    },
    // runTransition уже зависит от needed-сalls, но указываем явные деп-сы
    // через useCallback ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issuesById, issues, orgId, mutate, globalMutate, addToast],
  );

  const runTransition = useCallback(
    async (issueId: string, targetStateId: string) => {
      setPendingTransitionIssueId(issueId);
      try {
        await mutate(
          async () => {
            await issuesApi.transition(orgId, issueId, {
              stateId: targetStateId,
            });
            return undefined;
          },
          {
            optimisticData: (
              current: ListIssuesResponseApi | undefined,
            ): ListIssuesResponseApi => {
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
      } catch (err) {
        addToast({
          type: 'error',
          message: `Не удалось переместить задачу: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
          durationMs: 5000,
        });
        console.error(err);
      } finally {
        setPendingTransitionIssueId(null);
      }
    },
    [orgId, mutate, globalMutate, addToast],
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
        <SortableContext
          items={issues.map((i) => cardId(i.id))}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <SortableIssueCard
              key={issue.id}
              issue={issue}
              disabled={!column.accept}
              pending={pendingIssueId === issue.id}
            />
          ))}
        </SortableContext>
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

// ─── Sortable wrapper для карточки ──────────────────────────────────────────
// useSortable объединяет useDraggable + useDroppable: карточка одновременно
// может быть и драг-источником, и drop-target (для соседа в той же колонке —
// reorder). Drop в саму колонку остаётся через `useDroppable` на колонке.

function SortableIssueCard({
  issue,
  disabled,
  pending,
}: {
  issue: Issue;
  disabled?: boolean;
  pending?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useSortable({
      id: cardId(issue.id),
      disabled,
    });

  // Без `@dnd-kit/utilities` — простой translate3d (так уже было в проекте).
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

// ─── Phase 3 part C: AI-suggestions toast ───────────────────────────────────
//
// Helper, который читает `aiSuggestions` из ответа POST /issues и показывает
// 1–2 toast'а с действием «Принять». Вынесен в модульную функцию, чтобы
// `handleCreate` оставался читаемым.
//
// Логика принятия (см. ТЗ Phase 3 frontend):
//   - fields: показываем toast «AI предлагает: исполнитель, срок, цель.
//     Принять?» если `meetsThreshold === true` ИЛИ `confidence ≥ 0.7`
//     (двойная защита — backend сам отсекает по threshold, но клиент
//     перепроверяет на случай регрессии). Кнопка Accept → PATCH с
//     suggested полями.
//   - goal: если поле `goal` присутствует отдельно — показываем второй,
//     более лаконичный toast «Связать с целью? (∼60%)».

type ToastApi = ReturnType<typeof useToast>;
type AddToastFn = ToastApi['addToast'];

const AI_CONFIDENCE_THRESHOLD = 0.7;

interface ShowSuggestionsCtx {
  orgId: string;
  /** SWR-mutate `useIssues` — чтобы после accept лента доски обновилась. */
  mutateBoard: () => Promise<unknown>;
  addToast: AddToastFn;
}

function showAiSuggestionsToasts(
  issue: IssueApi,
  suggestions: IssueAiSuggestionsApi,
  ctx: ShowSuggestionsCtx,
): void {
  // 1) fields toast — полный комплект (assignee/dueDate/priority/labels)
  if (suggestions.fields) {
    const fields = suggestions.fields;
    const passesThreshold =
      fields.meetsThreshold === true ||
      fields.confidence >= AI_CONFIDENCE_THRESHOLD;
    if (passesThreshold) {
      const summary = buildFieldsSummary(fields);
      if (summary) {
        ctx.addToast({
          type: 'info',
          message: `AI предлагает: ${summary}. Принять?`,
          durationMs: 12000,
          action: {
            label: 'Принять',
            onClick: async () => {
              try {
                await acceptFieldSuggestions(issue.id, fields, ctx);
                await ctx.mutateBoard();
                ctx.addToast({
                  type: 'success',
                  message: 'Подсказки AI применены.',
                });
              } catch (err) {
                ctx.addToast({
                  type: 'error',
                  message: `Не удалось применить подсказки: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
                  durationMs: 5000,
                });
              }
            },
          },
        });
      }
    }
  }

  // 2) goal toast — отдельный, более короткий
  if (suggestions.goal && suggestions.goal.confidence >= AI_CONFIDENCE_THRESHOLD) {
    const goalId = suggestions.goal.goalId;
    const pct = Math.round(suggestions.goal.confidence * 100);
    ctx.addToast({
      type: 'info',
      message: `AI предлагает связать с целью (∼${pct}%). Принять?`,
      durationMs: 12000,
      action: {
        label: 'Связать',
        onClick: async () => {
          try {
            await issuesApi.linkGoal(ctx.orgId, issue.id, goalId);
            await ctx.mutateBoard();
            ctx.addToast({
              type: 'success',
              message: 'Задача связана с целью.',
            });
          } catch (err) {
            ctx.addToast({
              type: 'error',
              message: `Не удалось связать с целью: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
              durationMs: 5000,
            });
          }
        },
      },
    });
  }
}

/** Собирает человекочитаемое summary suggested-полей для toast-сообщения. */
function buildFieldsSummary(
  fields: NonNullable<IssueAiSuggestionsApi['fields']>,
): string | null {
  const parts: string[] = [];
  if (fields.suggestedAssigneeId) parts.push('исполнитель');
  if (fields.suggestedDueDate) {
    const dt = new Date(fields.suggestedDueDate);
    if (!Number.isNaN(dt.getTime())) {
      parts.push(
        `срок ${dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`,
      );
    } else {
      parts.push('срок');
    }
  }
  if (fields.suggestedPriority) {
    const prio = parseIssuePriority(fields.suggestedPriority);
    parts.push(`приоритет «${ISSUE_PRIORITY_LABELS[prio]}»`);
  }
  if (fields.suggestedGoalId) parts.push('цель');
  if (fields.suggestedLabels && fields.suggestedLabels.length > 0) {
    parts.push(`${fields.suggestedLabels.length} меток`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Применяет suggested-поля к задаче. Использует PATCH /issues/:id (для
 * скалярных полей) + POST .../assignees / labels (для коллекций), т.к.
 * сейчас в `UpdateIssueRequest` нет полей `assigneeUserIds` / `labelIds`.
 *
 * Goal-suggestion здесь НЕ применяем — для него отдельный toast (выше).
 */
async function acceptFieldSuggestions(
  issueId: string,
  fields: NonNullable<IssueAiSuggestionsApi['fields']>,
  ctx: ShowSuggestionsCtx,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.suggestedDueDate) patch.dueDate = fields.suggestedDueDate;
  if (fields.suggestedPriority) {
    patch.priority = parseIssuePriority(fields.suggestedPriority);
  }
  if (fields.suggestedGoalId) patch.goalId = fields.suggestedGoalId;
  if (Object.keys(patch).length > 0) {
    await issuesApi.update(ctx.orgId, issueId, patch);
  }
  if (fields.suggestedAssigneeId) {
    await issuesApi.addAssignee(ctx.orgId, issueId, fields.suggestedAssigneeId);
  }
  if (fields.suggestedLabels && fields.suggestedLabels.length > 0) {
    // Последовательное добавление меток: parallel `Promise.all` тоже
    // сработает, но при ошибке одного label другие успели бы
    // примениться — UX хуже. Дополнительный latency на синхронные
    // вызовы здесь незаметен (1–3 метки максимум).
    for (const labelId of fields.suggestedLabels) {
      await issuesApi.addLabel(ctx.orgId, issueId, labelId);
    }
  }
}
