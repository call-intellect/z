'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useCycles } from '@/hooks/tracker/useCycles';
import { CycleProgress } from '@/ui/tracker';
import { cyclesApi } from '@/api/tracker/cycles.api';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';


export function CyclesClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project, isLoading: pLoading } = useProjectBySlug(currentOrgId, slug);
  const { cycles, isLoading, error, mutate } = useCycles(currentOrgId, project?.id);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!currentOrgId || !project?.id) return;
    if (!name.trim() || !startDate || !endDate) {
      toast.error('Заполните название и даты спринта');
      return;
    }
    setCreating(true);
    try {
      await cyclesApi.create(currentOrgId, project.id, {
        name: name.trim(),
        startDate,
        endDate,
      });
      toast.success('Спринт создан');
      setName('');
      setStartDate('');
      setEndDate('');
      setShowForm(false);
      await mutate();
    } catch {
      toast.error('Не удалось создать спринт');
    } finally {
      setCreating(false);
    }
  };

  if (pLoading || isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-danger">Не удалось загрузить спринты.</div>;
  }

  if (!project) {
    return <div className="text-sm text-fg-tertiary">Проект не найден.</div>;
  }

  if (cycles.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center">
        <p className="mb-4 text-sm text-fg-tertiary">В этом проекте ещё нет спринтов.</p>

        {showForm ? (
          <div className="mx-auto max-w-sm space-y-3 text-left">
            <div className="space-y-1.5">
              <Label htmlFor="cycle-name">Название спринта</Label>
              <Input
                id="cycle-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Спринт 1"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cycle-start">Начало</Label>
                <Input
                  id="cycle-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-end">Конец</Label>
                <Input
                  id="cycle-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={creating} onClick={() => void handleCreate()}>
                {creating ? 'Создание…' : 'Создать'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={creating}
                onClick={() => {
                  setShowForm(false);
                  setName('');
                  setStartDate('');
                  setEndDate('');
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus size={14} className="mr-1" />
            Создать спринт
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {cycles.map((c) => (
        <Link
          key={c.id}
          href={`/projects/${slug}/cycles/${encodeURIComponent(c.id)}`}
          className="block"
        >
          <CycleProgress cycle={c} />
        </Link>
      ))}
    </div>
  );
}
