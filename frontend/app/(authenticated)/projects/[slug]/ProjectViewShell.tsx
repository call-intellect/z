'use client';

/**
 * ProjectViewShell — общий header + табы для всех страниц одного проекта.
 * Используется на /board, /list, /calendar, /gantt, /cycles, /intake, /settings.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/ui/shadcn/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { projectShortLabel, type Project } from '@/domain/tracker';

interface Tab {
  href: string;
  label: string;
  show?: (p: Project) => boolean;
}

function buildTabs(slug: string): Tab[] {
  return [
    { href: `/projects/${slug}/board`, label: 'Доска' },
    { href: `/projects/${slug}/list`, label: 'Список' },
    {
      href: `/projects/${slug}/cycles`,
      label: 'Циклы',
      show: (p) => p.cycleViewEnabled,
    },
    {
      href: `/projects/${slug}/intake`,
      label: 'Входящие',
      show: (p) => p.intakeViewEnabled,
    },
    { href: `/projects/${slug}/calendar`, label: 'Календарь' },
    {
      href: `/projects/${slug}/gantt`,
      label: 'Гант',
      show: (p) => p.gantViewEnabled,
    },
    // Tracker Project Documents (2026-05-27) — вкладка «Документы».
    // ТЗ: plans/tz/2026-05-27-tracker-project-documents.md.
    { href: `/projects/${slug}/documents`, label: 'Документы' },
    { href: `/projects/${slug}/settings`, label: 'Настройки' },
  ];
}

export function ProjectViewShell({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const { currentOrgId } = useAuth();
  const { project, isLoading, error } = useProjectBySlug(currentOrgId, slug);

  const tabs = buildTabs(slug).filter(
    (t) => !t.show || (project && t.show(project)),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border-subtle bg-bg-elevated px-4 py-3 md:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2">
          {isLoading ? (
            <div className="h-5 w-48 animate-pulse rounded bg-bg-overlay" />
          ) : error || !project ? (
            <h1 className="text-lg font-semibold text-fg-primary">
              Проект «{slug}»
            </h1>
          ) : (
            <h1 className="text-lg font-semibold text-fg-primary">
              {projectShortLabel(project)}
            </h1>
          )}

          <nav className="-mb-3 flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                    active
                      ? 'border-accent text-accent'
                      : 'border-transparent text-fg-tertiary hover:text-fg-secondary',
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
