'use client';

/**
 * ProjectBoardsSidebar — вторичная боковая панель внутри страницы проекта
 * (`/projects/[slug]/boards/[boardId]/*`). Показывает список досок проекта
 * с переключением между ними + inline-форму создания + меню действий.
 *
 * Tracker Boards (2026-05-27). ТЗ: plans/tz/2026-05-27-tracker-boards.md.
 *
 * Что есть в этой версии (MVP ТЗ):
 *   - Список досок с count задач и активной подсветкой.
 *   - Inline-кнопка «+ Доска» (раскрывается в input → Enter создаёт).
 *   - Архив (свёрнут, раскрывается по клику).
 *   - Context menu: Переименовать (inline) / Архив / Удалить (с confirm).
 *
 * Что отложено (ТЗ §"Что НЕ делаем"):
 *   - DnD задач между досками — только через IssueDetail (PATCH boardId).
 *   - DnD досок в боковой панели (sequence-update через @dnd-kit/sortable
 *     — закладка на следующую итерацию, чтобы не раздувать MVP).
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { boardsApi } from '@/api/tracker/boards.api';
import { useProjectBoards } from '@/hooks/useProjectBoards';
import { type Board } from '@/domain/tracker';
import { cn } from '@/ui/shadcn/lib/utils';

interface Props {
  orgId: string;
  projectId: string;
  projectSlug: string;
  /** id текущей выбранной доски (из URL) — для подсветки активной. */
  activeBoardId?: string;
  /** View текущей страницы (`board`/`list`/`calendar`) — сохраняется при переключении. */
  view?: 'board' | 'list' | 'calendar';
}

export function ProjectBoardsSidebar({
  orgId,
  projectId,
  projectSlug,
  activeBoardId,
  view = 'board',
}: Props) {
  const { boards, isLoading, error, mutate } = useProjectBoards(orgId, projectId, {
    includeArchived: true,
  });
  const [showArchived, setShowArchived] = useState(false);
  const [addingMode, setAddingMode] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);

  const live = boards.filter((b) => b.archivedAt === null);
  const archived = boards.filter((b) => b.archivedAt !== null);

  const handleCreate = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await boardsApi.create(orgId, projectId, { name: trimmed });
        await mutate();
        setAddingMode(false);
      } catch (err) {
        toast.error(
          `Не удалось создать доску: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        );
      }
    },
    [orgId, projectId, mutate],
  );

  const handleRename = useCallback(
    async (boardId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setRenameId(null);
        return;
      }
      try {
        await boardsApi.update(orgId, boardId, { name: trimmed });
        await mutate();
      } catch (err) {
        toast.error(
          `Не удалось переименовать: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        );
      } finally {
        setRenameId(null);
      }
    },
    [orgId, mutate],
  );

  const handleArchive = useCallback(
    async (boardId: string, currentlyArchived: boolean) => {
      try {
        if (currentlyArchived) {
          await boardsApi.unarchive(orgId, boardId);
        } else {
          await boardsApi.archive(orgId, boardId);
        }
        await mutate();
      } catch (err) {
        toast.error(
          `Не удалось ${currentlyArchived ? 'разархивировать' : 'архивировать'}: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        );
      }
    },
    [orgId, mutate],
  );

  const handleDelete = useCallback(
    async (board: Board) => {
      if (board.isDefault) {
        toast.error('Нельзя удалить основную доску проекта.');
        return;
      }
      if (
        !window.confirm(
          `Удалить доску «${board.name}»? Все её задачи переедут на основную доску.`,
        )
      ) {
        return;
      }
      try {
        const res = await boardsApi.remove(orgId, board.id);
        await mutate();
        toast.success(
          `Доска удалена. Перенесено задач: ${res.movedIssuesCount}.`,
        );
      } catch (err) {
        toast.error(
          `Не удалось удалить: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        );
      }
    },
    [orgId, mutate],
  );

  if (isLoading) {
    return (
      <aside
        className="flex w-60 shrink-0 flex-col gap-2 border-r border-border-subtle bg-bg-elevated/40 p-3"
        aria-label="Список досок проекта"
      >
        <div className="text-xs uppercase tracking-wider text-fg-tertiary">
          Доски
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-8 animate-pulse rounded-md bg-bg-overlay/60"
          />
        ))}
      </aside>
    );
  }

  if (error) {
    return (
      <aside
        className="flex w-60 shrink-0 flex-col gap-2 border-r border-border-subtle bg-bg-elevated/40 p-3"
        aria-label="Список досок проекта"
      >
        <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          Не удалось загрузить доски.
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="flex w-60 shrink-0 flex-col gap-2 border-r border-border-subtle bg-bg-elevated/40 p-3"
      aria-label="Список досок проекта"
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs uppercase tracking-wider text-fg-tertiary">
          Доски
        </span>
        <button
          type="button"
          onClick={() => setAddingMode(true)}
          className="rounded-md px-1.5 py-0.5 text-xs text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
          aria-label="Добавить доску"
        >
          + Доска
        </button>
      </div>

      <ul className="flex flex-col gap-0.5">
        {live.map((b) => (
          <li key={b.id}>
            {renameId === b.id ? (
              <RenameForm
                initial={b.name}
                onCancel={() => setRenameId(null)}
                onSubmit={(name) => handleRename(b.id, name)}
              />
            ) : (
              <BoardRow
                board={b}
                projectSlug={projectSlug}
                view={view}
                isActive={b.id === activeBoardId}
                onRename={() => setRenameId(b.id)}
                onArchive={() => handleArchive(b.id, false)}
                onDelete={() => handleDelete(b)}
              />
            )}
          </li>
        ))}
        {addingMode && (
          <li>
            <RenameForm
              initial=""
              placeholder="Название новой доски"
              onCancel={() => setAddingMode(false)}
              onSubmit={handleCreate}
            />
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-fg-tertiary hover:text-fg-secondary"
            aria-expanded={showArchived}
          >
            <span aria-hidden>{showArchived ? '▾' : '▸'}</span>
            Архив ({archived.length})
          </button>
          {showArchived && (
            <ul className="flex flex-col gap-0.5 opacity-70">
              {archived.map((b) => (
                <li key={b.id}>
                  <BoardRow
                    board={b}
                    projectSlug={projectSlug}
                    view={view}
                    isActive={b.id === activeBoardId}
                    onRename={() => setRenameId(b.id)}
                    onArchive={() => handleArchive(b.id, true)}
                    onDelete={() => handleDelete(b)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

function BoardRow({
  board,
  projectSlug,
  view,
  isActive,
  onRename,
  onArchive,
  onDelete,
}: {
  board: Board;
  projectSlug: string;
  view: 'board' | 'list' | 'calendar';
  isActive: boolean;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const href = `/projects/${encodeURIComponent(projectSlug)}/boards/${encodeURIComponent(board.id)}/${view}`;
  return (
    <div className="group flex items-center justify-between gap-1 rounded-md px-1.5 py-0.5">
      <Link
        href={href}
        className={cn(
          'flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors',
          isActive
            ? 'bg-accent/15 text-fg-primary'
            : 'text-fg-secondary hover:bg-bg-overlay/60 hover:text-fg-primary',
        )}
        aria-current={isActive ? 'page' : undefined}
      >
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: board.color }}
          aria-hidden
        />
        <span className="flex-1 truncate">
          {board.name}
          {board.isDefault && (
            <span className="ml-1 text-[10px] uppercase text-fg-tertiary">
              осн.
            </span>
          )}
        </span>
        {board.issuesCount !== null && board.issuesCount > 0 && (
          <span className="rounded bg-bg-overlay/60 px-1.5 text-[11px] text-fg-tertiary">
            {board.issuesCount}
          </span>
        )}
      </Link>
      <BoardActionsMenu
        canDelete={!board.isDefault}
        canArchive={!board.isDefault}
        isArchived={board.archivedAt !== null}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    </div>
  );
}

function BoardActionsMenu({
  canDelete,
  canArchive,
  isArchived,
  onRename,
  onArchive,
  onDelete,
}: {
  canDelete: boolean;
  canArchive: boolean;
  isArchived: boolean;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="opacity-0 transition-opacity hover:bg-bg-overlay/60 group-hover:opacity-100 rounded-md px-1.5 py-1 text-fg-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия с доской"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 flex w-44 flex-col rounded-md border border-border-subtle bg-bg-elevated p-1 text-sm shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            role="menuitem"
            className="rounded px-2 py-1 text-left hover:bg-bg-overlay"
            onClick={() => {
              onRename();
              setOpen(false);
            }}
          >
            Переименовать
          </button>
          {canArchive && (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left hover:bg-bg-overlay"
              onClick={() => {
                onArchive();
                setOpen(false);
              }}
            >
              {isArchived ? 'Снять архив' : 'Архивировать'}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-danger hover:bg-danger/10"
              onClick={() => {
                onDelete();
                setOpen(false);
              }}
            >
              Удалить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RenameForm({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
      className="px-1.5 py-0.5"
    >
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value === initial || value.trim() === '') {
            onCancel();
          } else {
            onSubmit(value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-sm focus:border-accent focus:outline-none"
        maxLength={120}
      />
    </form>
  );
}
