"use client";

import { useCallback, useMemo, useState } from "react";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useSWRConfig } from "swr";

import { useIssues } from "@/hooks/tracker/useIssues";
import { useStates } from "@/hooks/tracker/useStates";
import { issuesApi } from "@/api/tracker/issues.api";
import { humanizeApiError } from "@/api/api-error";
import { toast } from "sonner";
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
} from "@/domain/tracker";
import { IssueCard } from "./IssueCard";
import { QuickAdd } from "./QuickAdd";
import { cn } from "@/ui/shadcn/lib/utils";

const COL_PREFIX = "col:";
const CARD_PREFIX = "card:";
const cardId = (issueId: string): string => `${CARD_PREFIX}${issueId}`;
const colId = (stateId: string): string => `${COL_PREFIX}${stateId}`;
const parseColId = (id: string): string | null =>
  id.startsWith(COL_PREFIX) ? id.slice(COL_PREFIX.length) : null;
const parseCardId = (id: string): string | null =>
  id.startsWith(CARD_PREFIX) ? id.slice(CARD_PREFIX.length) : null;

function defaultResolveCategory(issue: Issue): IssueStateCategory {
  if (issue.isCompleted) return "completed";
  if (issue.archivedAt) return "cancelled";
  return "unstarted";
}

export function Board({
  orgId,
  projectId,
  boardId,
  resolveCategory = defaultResolveCategory,
}: {
  orgId: string;
  projectId: string;
  boardId?: string;
  resolveCategory?: (issue: Issue) => IssueStateCategory;
}) {
  const { issues, isLoading, error, mutate } = useIssues(orgId, projectId, {
    limit: 100,
    includeChildrenCount: true,
    boardId,
  });
  const { states, isLoading: statesLoading } = useStates(orgId, projectId);
  const { mutate: globalMutate } = useSWRConfig();
  const [creating, setCreating] = useState(false);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [pendingTransitionIssueId, setPendingTransitionIssueId] = useState<
    string | null
  >(null);

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
        const created = await issuesApi.create(orgId, projectId, {
          title,
          ...(boardId ? { boardId } : {}),
          inferSuggestions: true,
        });
        await mutate();
        if (created.aiSuggestions) {
          showAiSuggestionsToasts(created, created.aiSuggestions, {
            orgId,
            mutateBoard: mutate,
          });
        }
      } finally {
        setCreating(false);
      }
    },
    [orgId, projectId, boardId, mutate],
  );

  const issuesById = useMemo(() => {
    const m = new Map<string, Issue>();
    for (const i of issues) m.set(i.id, i);
    return m;
  }, [issues]);

  const activeIssue = activeIssueId
    ? (issuesById.get(activeIssueId) ?? null)
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

      const overCardId = parseCardId(String(over.id));
      const overColId = parseColId(String(over.id));

      if (overCardId && overCardId !== issueId) {
        const overIssue = issuesById.get(overCardId);
        if (!overIssue) return;
        const targetStateIdFromCard = overIssue.stateId;
        if (issue.stateId === targetStateIdFromCard && targetStateIdFromCard) {
          setPendingTransitionIssueId(issueId);
          try {
            await mutate(
              async () => {
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
                  const status =
                    err && typeof err === "object" && "status" in err
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
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                  const ids = sameColItems.map((it) => it.id);
                  const fromIdx = ids.indexOf(issueId);
                  const toIdx = ids.indexOf(overCardId);
                  if (fromIdx < 0 || toIdx < 0) return current;
                  const reorderedIds = arrayMove(ids, fromIdx, toIdx);
                  const orderMap = new Map<string, number>();
                  reorderedIds.forEach((id, idx) =>
                    orderMap.set(id, idx * 1000),
                  );
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
            toast.error(
              `Не удалось переставить задачу: ${humanizeApiError(err, "попробуйте ещё раз")}`,
              { duration: 5000 },
            );
            console.error(err);
          } finally {
            setPendingTransitionIssueId(null);
          }
          return;
        }
        if (targetStateIdFromCard && issue.stateId !== targetStateIdFromCard) {
          await runTransition(issueId, targetStateIdFromCard);
        }
        return;
      }

      const targetStateId = overColId;
      if (!targetStateId) return;

      if (issue.stateId === targetStateId) return;

      await runTransition(issueId, targetStateId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issuesById, issues, orgId, mutate, globalMutate],
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
            typeof key[0] === "string" &&
            (key[0] === "tracker.issue" ||
              key[0] === "tracker.issue.activity" ||
              key[0] === "me.inbox"),
          undefined,
          { revalidate: true },
        );
      } catch (err) {
        toast.error(
          `Не удалось переместить задачу: ${humanizeApiError(err, "попробуйте ещё раз")}`,
          { duration: 5000 },
        );
        console.error(err);
      } finally {
        setPendingTransitionIssueId(null);
      }
    },
    [orgId, mutate, globalMutate],
  );

  const columns = useMemo<BoardColumnSpec[]>(() => {
    if (states.length > 0) {
      return states.map((s) => ({
        kind: "state" as const,
        key: s.id,
        stateId: s.id,
        title: s.name,
        category: s.category,
        color: s.color,
        accept: true,
      }));
    }
    return ISSUE_STATE_CATEGORY_VALUES.map((cat) => ({
      kind: "category" as const,
      key: cat,
      stateId: null,
      title: ISSUE_STATE_CATEGORY_LABELS[cat],
      category: cat,
      color: null,
      accept: false,
    }));
  }, [states]);

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
        const fallback =
          columns.find((c) => c.category === "backlog")?.key ?? columns[0]?.key;
        if (fallback) result.get(fallback)?.push(issue);
      } else {
        const cat = resolveCategory(issue);
        const target = columns.find((c) => c.category === cat)?.key;
        if (target) result.get(target)?.push(issue);
      }
    }
    return result;
  }, [columns, issues, states.length, resolveCategory]);

  if (isLoading || statesLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ISSUE_STATE_CATEGORY_VALUES.map((cat) => (
          <BoardColumnSkeleton
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
        {columns.map((col, colIndex) => {
          const list = byColumn.get(col.key) ?? [];
          const showQuickAdd =
            col.category === "backlog" || col.category === "unstarted";
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
              tourTarget={colIndex === 0 ? "project.board-column" : undefined}
            />
          );
        })}
      </div>

      {}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <IssueCard issue={activeIssue} compact /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface BoardColumnSpec {
  kind: "state" | "category";
  key: string;
  stateId: string | null;
  title: string;
  category: IssueStateCategory;
  color: string | null;
  accept: boolean;
}

function BoardColumn({
  column,
  issues,
  pendingIssueId,
  quickAdd,
  disabled,
  tourTarget,
}: {
  column: BoardColumnSpec;
  issues: Issue[];
  pendingIssueId: string | null;
  quickAdd?: React.ReactNode;
  disabled?: boolean;
  tourTarget?: string;
}) {
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
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 transition-colors md:w-80",
        column.accept && isOver && "bg-bg-overlay/80 ring-2 ring-accent/60",
      )}
      aria-disabled={disabled}
      data-state-id={column.stateId ?? undefined}
      data-state-category={column.category}
      {...(tourTarget ? { "data-tour-target": tourTarget } : {})}
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

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0 : 1,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("touch-none", pending && "opacity-60")}
      aria-grabbed={isDragging}
    >
      <IssueCard issue={issue} />
    </div>
  );
}

const AI_CONFIDENCE_THRESHOLD = 0.7;

interface ShowSuggestionsCtx {
  orgId: string;
  mutateBoard: () => Promise<unknown>;
}

function showAiSuggestionsToasts(
  issue: IssueApi,
  suggestions: IssueAiSuggestionsApi,
  ctx: ShowSuggestionsCtx,
): void {
  if (suggestions.fields) {
    const fields = suggestions.fields;
    const passesThreshold =
      fields.meetsThreshold === true ||
      fields.confidence >= AI_CONFIDENCE_THRESHOLD;
    if (passesThreshold) {
      const summary = buildFieldsSummary(fields);
      if (summary) {
        toast(`Кора предлагает: ${summary}. Принять?`, {
          duration: 12000,
          action: {
            label: "Принять",
            onClick: async () => {
              try {
                await acceptFieldSuggestions(issue.id, fields, ctx);
                await ctx.mutateBoard();
                toast.success("Подсказки Коры применены.");
              } catch (err) {
                toast.error(
                  `Не удалось применить подсказки: ${humanizeApiError(err, "попробуйте ещё раз")}`,
                  { duration: 5000 },
                );
              }
            },
          },
        });
      }
    }
  }

  if (
    suggestions.goal &&
    suggestions.goal.confidence >= AI_CONFIDENCE_THRESHOLD
  ) {
    const goalId = suggestions.goal.goalId;
    const pct = Math.round(suggestions.goal.confidence * 100);
    toast(`Кора предлагает связать с целью (∼${pct}%). Принять?`, {
      duration: 12000,
      action: {
        label: "Связать",
        onClick: async () => {
          try {
            await issuesApi.linkGoal(ctx.orgId, issue.id, goalId);
            await ctx.mutateBoard();
            toast.success("Задача связана с целью.");
          } catch (err) {
            toast.error(
              `Не удалось связать с целью: ${humanizeApiError(err, "попробуйте ещё раз")}`,
              { duration: 5000 },
            );
          }
        },
      },
    });
  }
}

function buildFieldsSummary(
  fields: NonNullable<IssueAiSuggestionsApi["fields"]>,
): string | null {
  const parts: string[] = [];
  if (fields.suggestedAssigneeId) parts.push("исполнитель");
  if (fields.suggestedDueDate) {
    const dt = new Date(fields.suggestedDueDate);
    if (!Number.isNaN(dt.getTime())) {
      parts.push(
        `срок ${dt.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`,
      );
    } else {
      parts.push("срок");
    }
  }
  if (fields.suggestedPriority) {
    const prio = parseIssuePriority(fields.suggestedPriority);
    parts.push(`приоритет «${ISSUE_PRIORITY_LABELS[prio]}»`);
  }
  if (fields.suggestedGoalId) parts.push("цель");
  if (fields.suggestedLabels && fields.suggestedLabels.length > 0) {
    parts.push(`${fields.suggestedLabels.length} меток`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

async function acceptFieldSuggestions(
  issueId: string,
  fields: NonNullable<IssueAiSuggestionsApi["fields"]>,
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
    for (const labelId of fields.suggestedLabels) {
      await issuesApi.addLabel(ctx.orgId, issueId, labelId);
    }
  }
}
