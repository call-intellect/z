'use client';

/**
 * Board — канбан-доска проекта.
 *
 * Phase 2: 5 колонок по category (backlog / unstarted / started / completed /
 * cancelled). Группировка задач — по `isCompleted` фактической карточки (так как
 * полный объект IssueState мы пока не грузим в карточке). Когда появится
 * GET /states — заменим resolveCategory на реальный stateId → category.
 *
 * Drag-n-drop — Sprint 4 (отдельный тикет F1-4). Сейчас базовая верстка.
 */

import { useState } from 'react';
import { useIssues } from '@/hooks/tracker/useIssues';
import { issuesApi } from '@/api/tracker/issues.api';
import {
  ISSUE_STATE_CATEGORY_LABELS,
  ISSUE_STATE_CATEGORY_VALUES,
  type Issue,
  type IssueStateCategory,
} from '@/domain/tracker';
import { IssueCard } from './IssueCard';
import { QuickAdd } from './QuickAdd';

function defaultResolveCategory(issue: Issue): IssueStateCategory {
  if (issue.isCompleted) return 'completed';
  if (issue.archivedAt) return 'cancelled';
  // Без полной сущности state в Phase 2 — всё активное → unstarted.
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
  const [creating, setCreating] = useState(false);

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {ISSUE_STATE_CATEGORY_VALUES.map((cat) => (
          <BoardColumnSkeleton key={cat} category={cat} />
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

  // Группируем задачи по category.
  const byCategory = new Map<IssueStateCategory, Issue[]>();
  for (const cat of ISSUE_STATE_CATEGORY_VALUES) byCategory.set(cat, []);
  for (const issue of issues) {
    const cat = resolveCategory(issue);
    byCategory.get(cat)?.push(issue);
  }

  const handleCreate = async (title: string) => {
    setCreating(true);
    try {
      await issuesApi.create(orgId, projectId, { title });
      await mutate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {ISSUE_STATE_CATEGORY_VALUES.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        return (
          <BoardColumn
            key={cat}
            category={cat}
            issues={list}
            quickAdd={
              cat === 'backlog' || cat === 'unstarted' ? (
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
  );
}

function BoardColumn({
  category,
  issues,
  quickAdd,
  disabled,
}: {
  category: IssueStateCategory;
  issues: Issue[];
  quickAdd?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 md:w-80"
      aria-disabled={disabled}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs uppercase tracking-wider text-fg-secondary">
          {ISSUE_STATE_CATEGORY_LABELS[category]}
        </span>
        <span className="text-[11px] text-fg-tertiary">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
      {quickAdd}
    </div>
  );
}

function BoardColumnSkeleton({ category }: { category: IssueStateCategory }) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-overlay/40 p-2 md:w-80">
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-xs uppercase tracking-wider text-fg-secondary">
          {ISSUE_STATE_CATEGORY_LABELS[category]}
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
