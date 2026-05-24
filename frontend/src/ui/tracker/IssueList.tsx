'use client';

/**
 * IssueList — плоский список задач или с группировкой по category статуса.
 */

import { useMemo } from 'react';
import {
  ISSUE_STATE_CATEGORY_LABELS,
  ISSUE_STATE_CATEGORY_VALUES,
  type Issue,
  type IssueStateCategory,
} from '@/domain/tracker';
import { IssueCard } from './IssueCard';

export function IssueList({
  issues,
  group = false,
  emptyText = 'Пока нет задач',
  /**
   * Кастомный маппер задачи → category. По умолчанию использует stateId,
   * но в Phase 2 у нас нет полного state-объекта в карточке, поэтому
   * вернёт `unstarted` для всего. Передай свой mapper, если есть.
   */
  resolveCategory,
}: {
  issues: Issue[];
  group?: boolean;
  emptyText?: string;
  resolveCategory?: (issue: Issue) => IssueStateCategory;
}) {
  const grouped = useMemo(() => {
    if (!group) return null;
    const map = new Map<IssueStateCategory, Issue[]>();
    for (const cat of ISSUE_STATE_CATEGORY_VALUES) map.set(cat, []);
    for (const issue of issues) {
      const cat = resolveCategory
        ? resolveCategory(issue)
        : issue.isCompleted
          ? 'completed'
          : 'unstarted';
      const arr = map.get(cat);
      if (arr) arr.push(issue);
    }
    return map;
  }, [issues, group, resolveCategory]);

  if (issues.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
        {emptyText}
      </div>
    );
  }

  if (!group || !grouped) {
    return (
      <div className="flex flex-col gap-2">
        {issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {ISSUE_STATE_CATEGORY_VALUES.map((cat) => {
        const list = grouped.get(cat) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={cat} className="flex flex-col gap-2">
            <div className="text-xs uppercase tracking-wider text-fg-tertiary">
              {ISSUE_STATE_CATEGORY_LABELS[cat]} · {list.length}
            </div>
            <div className="flex flex-col gap-2">
              {list.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
