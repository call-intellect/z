'use client';

/**
 * ProjectPickerDialog — переиспользуемый диалог выбора проекта (с поиском и
 * inline-созданием нового проекта).
 *
 * Вынесен из `app/(authenticated)/intake/IntakeClient.tsx` (2026-06-15,
 * plans/tz/2026-06-15-issue-move-to-project.md), чтобы тем же пикером
 * пользовались два сценария:
 *   - триаж входящей без проекта (Intake);
 *   - перенос задачи в другой проект из карточки (IssueSidebar).
 *
 * Все строки — только русский (правило admin_ui_russian_only).
 */

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';

import { projectsApi } from '@/api/tracker/projects.api';
import { humanizeApiError } from '@/api/api-error';
import { useProjects } from '@/hooks/tracker/useProjects';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';

export function ProjectPickerDialog({
  orgId,
  open,
  onClose,
  onPick,
  excludeProjectId,
  title = 'Выбор проекта',
  description = 'Выберите проект.',
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
  /** Вызывается с id выбранного (или созданного) проекта. */
  onPick: (projectId: string) => void;
  /** Скрыть из списка текущий проект задачи (чтобы не «перенести в себя»). */
  excludeProjectId?: string | null;
  title?: string;
  description?: string;
}) {
  const [query, setQuery] = useState('');
  // Inline-создание проекта прямо из пикера (D1, ТЗ 2026-06-11).
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  useResetOnOpen(open, () => {
    setQuery('');
    setCreating(false);
    setNewName('');
    setSubmitting(false);
  });

  // Хук вызывается всегда (rules-of-hooks); ключ null, пока диалог закрыт.
  const { projects, isLoading, mutate } = useProjects(open ? orgId : null);

  const filtered = useMemo(() => {
    const base = excludeProjectId
      ? projects.filter((p) => p.id !== excludeProjectId)
      : projects;
    const q = query.trim().toLowerCase();
    if (q.length === 0) return base;
    return base.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query, excludeProjectId]);

  const handleCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (name.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      // Шлём только name — slug/identifier генерит сервер.
      const created = await projectsApi.create(orgId, { name });
      await mutate();
      onPick(created.id);
    } catch (e) {
      toast.error(
        `Не удалось создать проект: ${humanizeApiError(e, 'попробуйте ещё раз')}`,
        { duration: 5000 },
      );
      setSubmitting(false); // форма не теряет введённое имя
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{creating ? 'Новый проект' : title}</DialogTitle>
        </DialogHeader>
        {creating ? (
          <>
            <p className="text-sm text-fg-secondary">
              Введите название — остальное (код проекта) создадим автоматически.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreate();
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название проекта"
                maxLength={200}
                autoFocus
                disabled={submitting}
              />
            </form>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={submitting}
              >
                Назад
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={submitting || newName.trim().length === 0}
              >
                {submitting ? 'Создаём…' : 'Создать'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-secondary">{description}</p>
            <div className="relative">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск проекта…"
                className="pl-8"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border-subtle">
              {isLoading ? (
                <div className="px-3 py-6 text-center text-sm text-fg-tertiary">
                  Загружаем проекты…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-fg-tertiary">
                  Проекты не найдены.
                </div>
              ) : (
                <ul className="flex flex-col">
                  {filtered.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => onPick(project.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-primary hover:bg-bg-overlay"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {project.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-fg-tertiary">
                          {project.identifier}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Отмена
              </Button>
              <Button onClick={() => setCreating(true)}>+ Создать проект</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Сброс состояния формы при открытии диалога. Ловит переход open false → true.
 * Хук всегда вызывается в одном и том же порядке (rules-of-hooks).
 */
function useResetOnOpen(open: boolean, reset: () => void): void {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}
