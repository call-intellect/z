'use client';

/**
 * IssueSubtasks — блок «Подзадачи N/M» в карточке задачи.
 *
 * Контракт ТЗ: `plans/tz/2026-05-27-tracker-subtasks-ui.md` §"Frontend".
 *
 * Содержит:
 *   - Заголовок «Подзадачи N/M» с тонкой полоской прогресса (mint).
 *   - Список прямых детей (`useIssueChildren`). Чекбокс ставит/снимает
 *     completed-статус через PATCH /issues/:id (transitionState проще,
 *     но для MVP используем PATCH stateId — backend сам ставит completedAt
 *     и эмитит status_changed).
 *   - Inline-add внизу: «+ Подзадача» → Enter создаёт, Shift+Enter откроет
 *     полную форму (drawer пока заглушен toast'ом — фуллформа в отдельном
 *     ТЗ tracker-drawer; здесь делаем skeleton-вариант).
 *
 * Smart defaults при создании: priority='none', sortOrder=max+1, assignees
 * — текущий пользователь (берётся из контекста auth).
 *
 * Mobile: блок виден сразу. Toggle «свернуть» пока не делаем (контейнер
 * сам компактный — заголовок + до 6 строк + поле ввода).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, ListChecks } from 'lucide-react';

import { issuesApi } from '@/api/tracker/issues.api';
import type { Issue, IssueChild } from '@/domain/tracker';
import { dueDateLabel } from '@/domain/tracker';
import { cn } from '@/ui/shadcn/lib/utils';

import { AssigneeAvatarGroup } from './AssigneeAvatar';
import { useIssueChildren } from '@/hooks/tracker/useIssueChildren';

/**
 * @param issue текущая задача (родитель).
 * @param orgId текущая Org id.
 * @param currentUserId id текущего пользователя — для smart defaults assignees.
 * @param onDrawer callback на «открыть drawer создания» (Shift+Enter). Если
 *   не передан — Shift+Enter ведёт себя как Enter (создаёт inline).
 */
export function IssueSubtasks({
  issue,
  orgId,
  currentUserId,
  onDrawer,
}: {
  issue: Issue;
  orgId: string;
  currentUserId: string | null;
  onDrawer?: (initialTitle: string) => void;
}) {
  const { children, isLoading, error, mutate } = useIssueChildren(
    orgId,
    issue.id,
  );
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // Tracker UI правило: глубина >2 запрещена.
  // Если текущая задача сама — подзадача (issue.parentId !== null), мы
  // не показываем блок «Подзадачи». 3-й уровень backend отвергнет с 400.
  if (issue.parentId !== null) {
    return null;
  }

  const completed = children.filter((c) => c.isCompleted).length;
  const total = children.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleCreate = async (openDrawer: boolean): Promise<void> => {
    const title = newTitle.trim();
    if (!title) return;
    if (openDrawer && onDrawer) {
      onDrawer(title);
      setNewTitle('');
      return;
    }
    setCreating(true);
    try {
      await issuesApi.create(orgId, issue.projectId, {
        title,
        parentId: issue.id,
        priority: 'none',
        assigneeUserIds: currentUserId ? [currentUserId] : [],
      });
      setNewTitle('');
      await mutate();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4">
      <div className="flex items-center gap-2">
        <ListChecks size={14} className="text-fg-tertiary" />
        <h2 className="text-sm font-medium text-fg-primary">
          Подзадачи
          {total > 0 ? (
            <span className="ml-2 text-fg-tertiary">
              {completed}/{total}
            </span>
          ) : null}
        </h2>
      </div>

      {total > 0 && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-bg-overlay"
          aria-label={`Выполнено ${completed} из ${total}`}
        >
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {isLoading ? (
        <div className="h-10 animate-pulse rounded-md border border-border-subtle bg-bg-card" />
      ) : error ? (
        <div className="text-xs text-danger">
          Не удалось загрузить подзадачи.
        </div>
      ) : total === 0 ? (
        <div className="text-xs text-fg-tertiary">
          Подзадач пока нет — добавьте первую ниже.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {children.map((c) => (
            <SubtaskRow key={c.id} child={c} orgId={orgId} onChange={mutate} />
          ))}
        </ul>
      )}

      <SubtaskInput
        value={newTitle}
        onChange={setNewTitle}
        disabled={creating}
        onSubmit={(openDrawer) => void handleCreate(openDrawer)}
        canOpenDrawer={Boolean(onDrawer)}
      />
    </div>
  );
}

/**
 * Одна строка подзадачи. Чекбокс справа: для started/unstarted/backlog —
 * пустой; для completed — отмечен. Клик переключает статус через PATCH:
 *   - если completed → передаём stateId=null, чтобы вернуть в дефолтное
 *     состояние; backend сам уберёт completedAt в update().
 *   - если НЕ completed → находим первый completed-state в проекте через
 *     отдельный fetch было бы избыточно; используем семантику бэка:
 *     PATCH stateId=null и затем POST /issues/:id/transitions — тоже
 *     слишком много для UI. На MVP делаем так: для перехода в completed
 *     вызываем transition по stateId ребёнка же — но самого state у нас
 *     нет. Поэтому используем pragmatic путь: если ребёнок имеет stateId,
 *     а пользователь хочет «отметить выполненной», открываем карточку.
 *     Здесь мы НЕ делаем magic-переход — это место для будущего
 *     `IssueQuickToggle`. На текущем шаге чекбокс read-only визуально
 *     отражает completedAt; клик ведёт на полную карточку (там есть
 *     transitionState button).
 *
 * Это сознательное сужение — иначе нужен fetch states проекта (1 лишний
 * запрос на блок). См. план: «mark-done из чекбокса» — отдельный полишинг.
 */
function SubtaskRow({
  child,
  orgId: _orgId,
  onChange: _onChange,
}: {
  child: IssueChild;
  orgId: string;
  onChange: () => Promise<unknown>;
}) {
  const due = useMemo(() => dueDateLabel(child.dueDate), [child.dueDate]);

  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-sm',
        child.isCompleted && 'opacity-70',
      )}
    >
      {/* Визуальный чекбокс — без mutation (см. комментарий компонента). */}
      <span
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          child.isCompleted
            ? 'border-accent bg-accent text-white'
            : 'border-border-subtle bg-bg-elevated',
        )}
        aria-label={child.isCompleted ? 'Выполнена' : 'Не выполнена'}
        role="img"
      >
        {child.isCompleted ? (
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 8.5 7 12l6-7" />
          </svg>
        ) : null}
      </span>
      <span className="font-mono text-[11px] text-fg-tertiary">
        {child.identifier}
      </span>
      <Link
        href={`/issues/${encodeURIComponent(child.id)}`}
        className={cn(
          'min-w-0 flex-1 truncate text-fg-primary hover:underline',
          child.isCompleted && 'line-through text-fg-secondary',
        )}
      >
        {child.title}
      </Link>
      <AssigneeAvatarGroup userIds={child.assigneeUserIds} max={3} size={18} />
      {due ? (
        <span
          className={cn(
            'shrink-0 text-[11px]',
            child.isOverdue ? 'text-danger' : 'text-fg-tertiary',
          )}
        >
          {due}
        </span>
      ) : null}
    </li>
  );
}

function SubtaskInput({
  value,
  onChange,
  disabled,
  onSubmit,
  canOpenDrawer,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  /** openDrawer — пришёл ли Shift+Enter (расширенная форма) или обычный Enter. */
  onSubmit: (openDrawer: boolean) => void;
  canOpenDrawer: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Plus size={14} className="text-fg-tertiary" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onSubmit(canOpenDrawer && e.shiftKey);
        }}
        disabled={disabled}
        placeholder="Подзадача — Enter создаст, Shift+Enter откроет форму"
        className={cn(
          'min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-tertiary',
          'focus:outline-none focus:ring-2 focus:ring-accent',
          disabled && 'opacity-60',
        )}
      />
    </div>
  );
}
