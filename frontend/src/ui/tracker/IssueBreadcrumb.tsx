'use client';

/**
 * IssueBreadcrumb — навигация «← родитель / эта задача» на странице подзадачи.
 *
 * Появляется только когда у задачи задан `parentId`. Используется
 * `IssueDetailClient` на странице `/issues/[id]`.
 *
 * Контракт ТЗ: `plans/tz/2026-05-27-tracker-subtasks-ui.md` §"Навигация вверх".
 *
 * Реализация:
 *   - Тянем родителя через `useIssue(parentIssueId)` (с собственным SWR-ключом).
 *   - До загрузки — показываем skeleton, чтобы не дёргать layout.
 *   - При ошибке — тихо прячемся (родитель мог быть soft-deleted, в этом
 *     случае не блокируем чтение подзадачи).
 *
 * NB: не делаем рекурсивный обход «вверх» — depth ограничен 2, у родителя
 * нет своего parentId по правилу `max_subtask_depth_exceeded`.
 */

import Link from 'next/link';
import { ChevronLeft, Slash } from 'lucide-react';

import { useIssue } from '@/hooks/tracker/useIssue';
import type { Issue } from '@/domain/tracker';

export function IssueBreadcrumb({
  orgId,
  parentIssueId,
  currentIssue,
}: {
  orgId: string;
  parentIssueId: string;
  currentIssue: Issue;
}) {
  const { issue: parent, isLoading, error } = useIssue(orgId, parentIssueId);

  if (isLoading) {
    return (
      <div className="mb-3 h-5 w-64 animate-pulse rounded bg-bg-overlay" />
    );
  }
  if (error || !parent) {
    // Тихо прячем breadcrumb — задача без родителя в кэше всё равно
    // читается; не блокируем основной flow.
    return null;
  }

  return (
    <nav className="mb-3 flex items-center gap-1 text-xs text-fg-tertiary" aria-label="Хлебные крошки">
      <Link
        href={`/issues/${encodeURIComponent(parent.id)}`}
        className="inline-flex items-center gap-1 hover:underline"
      >
        <ChevronLeft size={12} />
        <span className="font-mono">{parent.identifier}</span>
        <span className="max-w-[24ch] truncate text-fg-secondary">
          «{parent.title}»
        </span>
      </Link>
      <Slash size={10} className="text-fg-tertiary" />
      <span className="font-mono">{currentIssue.identifier}</span>
      <span className="max-w-[24ch] truncate text-fg-secondary">
        «{currentIssue.title}»
      </span>
    </nav>
  );
}
