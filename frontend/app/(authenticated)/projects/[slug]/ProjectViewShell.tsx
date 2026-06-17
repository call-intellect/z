'use client';

/**
 * ProjectViewShell — общий header + табы для всех страниц одного проекта.
 * Используется на /board, /list, /calendar, /gantt, /cycles, /intake, /settings.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { projectShortLabel, type Project } from '@/domain/tracker';
import { useTour } from '@/ui/tour';
import { useRegisterBreadcrumb } from '@/ui/components/breadcrumbs/BreadcrumbContext';

interface Tab {
  href: string;
  label: string;
  show?: (p: Project) => boolean;
  group: 'primary' | 'secondary';
}

function buildTabs(slug: string): Tab[] {
  // A4 (2026-06-06): primary на виду, остальное под «Ещё ▾».
  return [
    { href: `/projects/${slug}/overview`, label: 'Обзор', group: 'primary' },
    { href: `/projects/${slug}/board`, label: 'Доска', group: 'primary' },
    { href: `/projects/${slug}/list`, label: 'Список', group: 'primary' },
    { href: `/projects/${slug}/calendar`, label: 'Календарь', group: 'primary' },
    { href: `/projects/${slug}/cycles`, label: 'Спринты', show: (p) => p.cycleViewEnabled, group: 'primary' },
    { href: `/projects/${slug}/settings`, label: 'Настройки', group: 'primary' },
    // secondary — под «Ещё ▾»
    { href: `/projects/${slug}/documents`, label: 'Документы', group: 'secondary' },
    { href: `/projects/${slug}/integrations`, label: 'Приложения', group: 'secondary' },
    { href: `/projects/${slug}/workload`, label: 'Загруженность', group: 'secondary' },
    { href: `/projects/${slug}/intake`, label: 'Входящие', show: (p) => p.intakeViewEnabled, group: 'secondary' },
    { href: `/projects/${slug}/gantt`, label: 'Гант', show: (p) => p.gantViewEnabled, group: 'secondary' },
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

  // Хлебные крошки: имя проекта из уже загруженного объекта (без доп. запроса).
  useRegisterBreadcrumb(project ? { label: projectShortLabel(project) } : null);

  // ТЗ 2026-05-27 onboarding-tour — авто-запуск тура «project» при первом
  // открытии любой страницы проекта. Если уже завершён/пропущен — no-op.
  useTour('project');

  const visibleTabs = buildTabs(slug).filter(
    (t) => !t.show || (project && t.show(project)),
  );
  const primaryTabs = visibleTabs.filter((t) => t.group === 'primary');
  const secondaryTabs = visibleTabs.filter((t) => t.group === 'secondary');
  const activeSecondary = secondaryTabs.some((t) => t.href === pathname);

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

          <nav className="-mb-3 flex items-center gap-1 overflow-x-auto">
            {primaryTabs.map((tab) => {
              const active = pathname === tab.href;
              const isOverview = tab.label === 'Обзор';
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
                  {...(isOverview
                    ? { 'data-tour-target': 'project.overview-tab' }
                    : {})}
                >
                  {tab.label}
                </Link>
              );
            })}

            {secondaryTabs.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                      activeSecondary
                        ? 'border-accent text-accent'
                        : 'border-transparent text-fg-tertiary hover:text-fg-secondary',
                    )}
                  >
                    Ещё
                    <ChevronDown size={14} aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {secondaryTabs.map((tab) => (
                    <DropdownMenuItem key={tab.href} asChild>
                      <Link
                        href={tab.href}
                        className={cn(
                          'w-full cursor-pointer',
                          pathname === tab.href && 'text-accent',
                        )}
                      >
                        {tab.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-6 w-64 animate-pulse rounded bg-bg-overlay" />
            <div className="h-40 animate-pulse rounded-md bg-bg-overlay/40" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 p-6 text-center text-sm text-danger">
            Не удалось загрузить проект. Проверьте подключение и обновите
            страницу.
          </div>
        ) : !project ? (
          <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
            Проект «{slug}» не найден. Возможно, он был удалён или у вас нет
            доступа.
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
