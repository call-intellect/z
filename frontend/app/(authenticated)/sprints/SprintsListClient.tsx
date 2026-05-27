'use client';

/**
 * `/sprints` — список спринтов организации (Wave 4, MVP).
 *
 * На бэкенде отдельного `GET /sprints` нет. Полноценный список реализуем
 * в следующей итерации (нужен агрегирующий endpoint, не цикл по проектам).
 * Сейчас страница показывает пояснение и ведёт пользователя в `/projects`
 * — спринт создаётся как Cycle внутри проекта.
 *
 * Цель этой страницы в Wave 4 — корректный sidebar-таргет `welcome.sprints`
 * и точка входа для будущего onboarding tour.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Rocket, FolderKanban } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { useAuth } from '@/contexts/auth-context';
import { SprintCreateWizard } from '@/ui/tracker/SprintCreateWizard';

export function SprintsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Спринты
          </h1>
          <p className="text-sm text-fg-tertiary">
            Циклы работы команды — компания, отдел, клиент, поставщик или проект.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={() => setWizardOpen(true)}
          >
            <Plus size={14} />
            Создать спринт
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/projects">
              <FolderKanban size={14} />К проектам
            </Link>
          </Button>
        </div>
      </header>

      <SprintCreateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />

      {authLoading ? (
        <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      ) : !currentOrgId ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
          Сначала выберите организацию.
        </div>
      ) : (
        <Placeholder />
      )}
    </div>
  );
}

function Placeholder() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-6 py-12 text-center">
      <Rocket size={28} className="text-fg-tertiary" />
      <div className="text-sm font-medium text-fg-primary">
        Список спринтов в разработке
      </div>
      <p className="max-w-md text-xs text-fg-tertiary">
        Пока создайте спринт как цикл внутри проекта. Каждый цикл — это спринт
        со своим дашбордом, помощником и финальным отчётом.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2 gap-2">
        <Link href="/projects">
          <FolderKanban size={14} />
          Открыть проекты
        </Link>
      </Button>
    </div>
  );
}
