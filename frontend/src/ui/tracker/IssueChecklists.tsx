'use client';

/**
 * IssueChecklists — блок чек-листов в карточке задачи (2026-05-27).
 *
 * Контракт TZ: `plans/tz/2026-05-27-tracker-checklists.md`.
 *
 * Состав:
 *   - Список существующих чек-листов задачи (заголовок + прогресс «3/7» +
 *     mint-полоса + список пунктов).
 *   - Пункт: чекбокс + inline-edit текста + DnD-handle + кнопка «×».
 *   - «+ Пункт» под каждым чек-листом (Enter создаёт, Esc закрывает).
 *   - Bulk-paste: paste многострочного текста → модалка «Создать N пунктов?».
 *   - «+ Чек-лист» внизу всех существующих.
 *
 * Live-обновления: WS-события `checklist.*` / `checklist_item.*` /
 * `issue.checklist_progress_changed` автоинвалидируют SWR через
 * `useTrackerLiveRefresh` (используется в IssueDetailClient).
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, Plus, X } from 'lucide-react';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { checklistsApi } from '@/api/tracker/checklists.api';
import {
  checklistProgressLabel,
  type Checklist,
  type ChecklistItem,
} from '@/domain/tracker';
import { useIssueChecklists } from '@/hooks/tracker/useIssueChecklists';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/ui/shadcn/lib/utils';

export interface IssueChecklistsProps {
  orgId: string;
  issueId: string;
}

export function IssueChecklists({ orgId, issueId }: IssueChecklistsProps) {
  const { checklists, isLoading, error, mutate } = useIssueChecklists(
    orgId,
    issueId,
  );

  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const [bulkPaste, setBulkPaste] = useState<{
    checklistId: string;
    lines: string[];
  } | null>(null);

  const handleAddChecklist = useCallback(async () => {
    setCreatingChecklist(true);
    try {
      await checklistsApi.createChecklist(orgId, issueId, {});
      await mutate();
    } finally {
      setCreatingChecklist(false);
    }
  }, [orgId, issueId, mutate]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-6 w-32 animate-pulse rounded bg-bg-overlay" />
        <div className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
        Не удалось загрузить чек-листы.{' '}
        <button
          type="button"
          onClick={() => void mutate()}
          className="underline underline-offset-2"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checklists.length === 0 && (
        <div className="rounded-md border border-dashed border-border-subtle p-3 text-sm text-fg-tertiary">
          Здесь пока нет чек-листов. Добавьте список микро-пунктов, которые не
          стоит выносить в отдельные подзадачи.
        </div>
      )}

      {checklists.map((cl) => (
        <ChecklistBlock
          key={cl.id}
          orgId={orgId}
          checklist={cl}
          onChange={mutate}
          onBulkPaste={(lines) => setBulkPaste({ checklistId: cl.id, lines })}
        />
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={creatingChecklist}
          onClick={() => void handleAddChecklist()}
        >
          {creatingChecklist ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1 size-4" />
          )}
          Добавить чек-лист
        </Button>
      </div>

      {bulkPaste && (
        <BulkPasteDialog
          checklistId={bulkPaste.checklistId}
          lines={bulkPaste.lines}
          orgId={orgId}
          onClose={() => setBulkPaste(null)}
          onCreated={async () => {
            setBulkPaste(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

// ── Один чек-лист ─────────────────────────────────────────────────────────

interface ChecklistBlockProps {
  orgId: string;
  checklist: Checklist;
  onChange: () => Promise<unknown>;
  onBulkPaste: (lines: string[]) => void;
}

function ChecklistBlock({
  orgId,
  checklist,
  onChange,
  onBulkPaste,
}: ChecklistBlockProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(checklist.title);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(checklist.title);
  }, [checklist.title]);

  const progress = checklistProgressLabel(
    checklist.totalCount,
    checklist.doneCount,
  );

  const handleTitleSubmit = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (!trimmed || trimmed === checklist.title) {
      setTitle(checklist.title);
      return;
    }
    await checklistsApi.updateChecklist(orgId, checklist.id, { title: trimmed });
    await onChange();
  }, [orgId, checklist.id, checklist.title, title, onChange]);

  const handleDeleteChecklist = useCallback(async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Удалить чек-лист и все его пункты?')
    ) {
      return;
    }
    setBusy(true);
    try {
      await checklistsApi.deleteChecklist(orgId, checklist.id);
      await onChange();
    } finally {
      setBusy(false);
    }
  }, [orgId, checklist.id, onChange]);

  const handleAddItem = useCallback(async () => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await checklistsApi.createItem(orgId, checklist.id, { text: trimmed });
      setNewText('');
      await onChange();
    } finally {
      setBusy(false);
    }
  }, [orgId, checklist.id, newText, onChange]);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text');
      if (!text || !text.includes('\n')) return;
      e.preventDefault();
      const lines = text
        .split(/\r?\n/u)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) return;
      if (lines.length === 1) {
        // Одна строка — просто вставляем в input.
        setNewText(lines[0] ?? '');
        return;
      }
      // Несколько строк — bulk-paste UX через модалку.
      onBulkPaste(lines);
      setNewText('');
      setAdding(false);
    },
    [onBulkPaste],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const ids = checklist.items.map((i) => i.id);
      const fromIdx = ids.indexOf(String(active.id));
      const toIdx = ids.indexOf(String(over.id));
      if (fromIdx < 0 || toIdx < 0) return;
      const nextOrder = [...ids];
      nextOrder.splice(fromIdx, 1);
      nextOrder.splice(toIdx, 0, String(active.id));
      await checklistsApi.reorderItems(orgId, {
        checklistId: checklist.id,
        itemIds: nextOrder,
      });
      await onChange();
    },
    [orgId, checklist.id, checklist.items, onChange],
  );

  const itemIds = useMemo(
    () => checklist.items.map((i) => i.id),
    [checklist.items],
  );

  return (
    <section className="rounded-md border border-border-subtle bg-bg-elevated p-3">
      <header className="flex items-center gap-2">
        {editingTitle ? (
          <input
            type="text"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void handleTitleSubmit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleTitleSubmit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTitle(checklist.title);
                setEditingTitle(false);
              }
            }}
            className="flex-1 rounded border border-border-subtle bg-bg-card px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            className="flex-1 truncate text-left text-sm font-medium text-fg-primary hover:text-accent"
          >
            {checklist.title}
          </button>
        )}
        {progress !== null && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
              checklist.isFullyCompleted
                ? 'bg-success/15 text-success'
                : 'bg-bg-overlay text-fg-secondary',
            )}
          >
            {progress}
          </span>
        )}
        <button
          type="button"
          aria-label="Удалить чек-лист"
          onClick={() => void handleDeleteChecklist()}
          disabled={busy}
          className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay hover:text-danger"
        >
          <X className="size-4" />
        </button>
      </header>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay"
        aria-hidden="true"
      >
        <div
          className={cn(
            'h-full transition-all',
            checklist.isFullyCompleted ? 'bg-success' : 'bg-accent',
          )}
          style={{ width: `${Math.round(checklist.progressRatio * 100)}%` }}
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => void handleDragEnd(e)}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <ul className="mt-2 flex flex-col">
            {checklist.items.map((it) => (
              <ChecklistItemRow
                key={it.id}
                orgId={orgId}
                item={it}
                onChange={onChange}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="mt-2">
        {adding ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newText}
              autoFocus
              placeholder="Введите текст пункта… (paste — массовое создание)"
              onChange={(e) => setNewText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddItem();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setAdding(false);
                  setNewText('');
                }
              }}
              onBlur={() => {
                if (!newText.trim()) setAdding(false);
              }}
              className="flex-1 rounded border border-border-subtle bg-bg-card px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void handleAddItem()}
              disabled={busy || !newText.trim()}
            >
              Добавить
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm text-fg-tertiary hover:text-accent"
          >
            <Plus className="size-4" />
            Пункт
          </button>
        )}
      </div>
    </section>
  );
}

// ── Один пункт ──────────────────────────────────────────────────────────

interface ChecklistItemRowProps {
  orgId: string;
  item: ChecklistItem;
  onChange: () => Promise<unknown>;
}

function ChecklistItemRow({ orgId, item, onChange }: ChecklistItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(item.text);
  }, [item.text]);

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const handleToggle = useCallback(async () => {
    setBusy(true);
    try {
      await checklistsApi.updateItem(orgId, item.id, { isDone: !item.isDone });
      await onChange();
    } finally {
      setBusy(false);
    }
  }, [orgId, item.id, item.isDone, onChange]);

  const handleTextSubmit = useCallback(async () => {
    setEditing(false);
    const trimmed = text.trim();
    if (!trimmed || trimmed === item.text) {
      setText(item.text);
      return;
    }
    setBusy(true);
    try {
      await checklistsApi.updateItem(orgId, item.id, { text: trimmed });
      await onChange();
    } finally {
      setBusy(false);
    }
  }, [orgId, item.id, item.text, text, onChange]);

  const handleDelete = useCallback(async () => {
    setBusy(true);
    try {
      await checklistsApi.deleteItem(orgId, item.id);
      await onChange();
    } finally {
      setBusy(false);
    }
  }, [orgId, item.id, onChange]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-bg-card"
    >
      <button
        type="button"
        aria-label="Перетащить пункт"
        {...attributes}
        {...listeners}
        className="cursor-grab text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100"
      >
        <GripVertical className="size-4" />
      </button>

      <label className="flex shrink-0 items-center">
        <input
          type="checkbox"
          checked={item.isDone}
          disabled={busy}
          onChange={() => void handleToggle()}
          className="size-5 cursor-pointer accent-accent"
        />
      </label>

      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void handleTextSubmit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleTextSubmit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setText(item.text);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-border-subtle bg-bg-card px-2 py-0.5 text-sm text-fg-primary outline-none focus:border-accent"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-sm',
            item.isDone
              ? 'text-fg-tertiary line-through'
              : 'text-fg-primary hover:text-accent',
          )}
        >
          {item.text}
        </button>
      )}

      <button
        type="button"
        aria-label="Удалить пункт"
        onClick={() => void handleDelete()}
        disabled={busy}
        className="rounded p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-bg-overlay hover:text-danger group-hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

// ── Bulk-paste модалка ───────────────────────────────────────────────────

interface BulkPasteDialogProps {
  checklistId: string;
  lines: string[];
  orgId: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

function BulkPasteDialog({
  checklistId,
  lines,
  orgId,
  onClose,
  onCreated,
}: BulkPasteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ТЗ: bulk-create — до 50 строк.
  const limited = lines.slice(0, 50);
  const preview = limited.slice(0, 5);

  const handleSubmit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      await checklistsApi.bulkCreateItems(orgId, {
        checklistId,
        lines: limited,
      });
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать пункты');
      setBusy(false);
    }
  }, [orgId, checklistId, limited, onCreated]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-overlay/80 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-md border border-border-subtle bg-bg-card p-4 shadow-lg">
        <h3 className="text-sm font-medium text-fg-primary">
          Создать {limited.length}{' '}
          {pluralizeRu(limited.length, 'пункт', 'пункта', 'пунктов')}?
        </h3>
        <p className="mt-1 text-xs text-fg-tertiary">
          В буфере обмена несколько строк. Будут созданы как отдельные пункты
          чек-листа.
        </p>

        <ul className="mt-3 space-y-1 rounded border border-border-subtle bg-bg-elevated p-2 text-sm text-fg-secondary">
          {preview.map((l, idx) => (
            <li key={idx} className="truncate">
              {idx + 1}. {l}
            </li>
          ))}
          {limited.length > preview.length && (
            <li className="text-xs text-fg-tertiary">
              … и ещё {limited.length - preview.length}
            </li>
          )}
        </ul>

        {lines.length > 50 && (
          <p className="mt-2 text-xs text-warning">
            Будут созданы только первые 50 строк (ограничение).
          </p>
        )}

        {err && (
          <p className="mt-2 text-xs text-danger">{err}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Создать
          </Button>
        </div>
      </div>
    </div>
  );
}

function pluralizeRu(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
