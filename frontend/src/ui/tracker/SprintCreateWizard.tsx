'use client';

/**
 * SprintCreateWizard — мастер создания спринта.
 *
 * MVP-объём (Wave 4): только создание цикла (Cycle) внутри уже существующего
 * проекта. Создание нового scope-проекта (отдел/клиент/поставщик/сотрудник)
 * — TODO для следующей итерации.
 *
 * Шаги:
 *   1) Выбор существующего проекта (combobox из useProjects).
 *   2) Название цикла + длительность (1/2/3/4 недели) + дата начала.
 * Отправка: POST /api/v1/projects/:projectId/cycles.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Rocket } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { useAuth } from '@/contexts/auth-context';
import { useProjects } from '@/hooks/tracker/useProjects';
import { cyclesApi } from '@/api/tracker/cycles.api';
import { cn } from '@/ui/shadcn/lib/utils';

const DURATION_OPTIONS = [
  { value: 7, label: '1 неделя' },
  { value: 14, label: '2 недели' },
  { value: 21, label: '3 недели' },
  { value: 28, label: '4 недели' },
] as const;

function toIsoDate(d: Date): string {
  // YYYY-MM-DD без timezone-смещения.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function SprintCreateWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (cycleId: string) => void;
}) {
  const { currentOrgId } = useAuth();
  const router = useRouter();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrgId);

  const today = useMemo(() => toIsoDate(new Date()), []);
  const [projectId, setProjectId] = useState<string>('');
  const [name, setName] = useState('');
  const [durationDays, setDurationDays] = useState<number>(14);
  const [startDate, setStartDate] = useState<string>(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setProjectId('');
    setName('');
    setDurationDays(14);
    setStartDate(today);
    setError(null);
    setPending(false);
  };

  const handleClose = () => {
    if (pending) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!currentOrgId) return;
    if (!projectId) {
      setError('Выберите проект.');
      return;
    }
    if (!name.trim()) {
      setError('Укажите название спринта.');
      return;
    }
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      setError('Некорректная дата начала.');
      return;
    }
    const end = new Date(start);
    // Включительные дни: цикл длится `durationDays` дней.
    end.setDate(end.getDate() + durationDays - 1);

    setPending(true);
    setError(null);
    try {
      const cycle = await cyclesApi.create(currentOrgId, projectId, {
        name: name.trim(),
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
      });
      onCreated?.(cycle.id);
      reset();
      onClose();
      router.push(`/sprints/${encodeURIComponent(cycle.id)}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось создать спринт.',
      );
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket size={18} className="text-accent" />
            Новый спринт
          </DialogTitle>
          <DialogDescription>
            Спринт — это цикл внутри проекта. Привязка к клиенту, поставщику,
            отделу или сотруднику задаётся при создании проекта.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Шаг 1 — проект */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sprint-project">Проект</Label>
            {projectsLoading ? (
              <div className="h-9 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
            ) : projects.length === 0 ? (
              <p className="text-xs text-fg-tertiary">
                Сначала создайте проект в разделе «Проекты».
              </p>
            ) : (
              <select
                id="sprint-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={cn(
                  'min-h-10 rounded-md border border-border-subtle bg-bg-elevated px-3 text-sm text-fg-primary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
              >
                <option value="">— выберите проект —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.identifier} · {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Шаг 2 — параметры */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sprint-name">Название спринта</Label>
            <Input
              id="sprint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Спринт 12 — релиз 4.2"
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Длительность</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt) => {
                const isActive = durationDays === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDurationDays(opt.value)}
                    className={cn(
                      'inline-flex items-center rounded-md border px-3 py-1.5 text-xs transition-colors',
                      isActive
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border-subtle bg-bg-elevated text-fg-secondary hover:bg-bg-overlay',
                    )}
                    aria-pressed={isActive}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sprint-start">Дата начала</Label>
            <Input
              id="sprint-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          <p className="text-[11px] text-fg-tertiary">
            Привязка спринта к клиенту, поставщику, отделу или сотруднику будет
            доступна в следующей версии мастера. Сейчас цикл создаётся внутри
            выбранного проекта.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={pending}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={pending || !currentOrgId}
            className="gap-2"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : null}
            Создать спринт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
