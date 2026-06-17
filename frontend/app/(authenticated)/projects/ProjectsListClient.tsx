"use client";

import Link from "next/link";
import { Plus, FolderKanban } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { useAuth } from "@/contexts/auth-context";
import { useProjects } from "@/hooks/tracker/useProjects";
import { projectShortLabel } from "@/domain/tracker";

export function ProjectsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  const { projects, isLoading, error } = useProjects(currentOrgId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Проекты
          </h1>
          <p className="text-sm text-fg-tertiary">
            Все проекты вашей организации
          </p>
        </div>
        <Button asChild size="sm" className="gap-2">
          <Link href="/projects/new">
            <Plus size={14} />
            Новый проект
          </Link>
        </Button>
      </header>

      {authLoading || isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить проекты. Обновите страницу.
        </div>
      ) : !currentOrgId ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
          Сначала выберите организацию.
        </div>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${encodeURIComponent(p.slug)}/board`}
                className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-elevated px-4 py-3 transition-colors hover:border-border hover:bg-bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-muted text-accent">
                    <FolderKanban size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg-primary">
                      {projectShortLabel(p)}
                    </div>
                    {p.description && (
                      <div className="truncate text-xs text-fg-tertiary">
                        {p.description}
                      </div>
                    )}
                  </div>
                </div>
                {p.archivedAt && (
                  <span className="text-[11px] uppercase text-fg-tertiary">
                    Архив
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-6 py-12 text-center">
      <FolderKanban size={28} className="text-fg-tertiary" />
      <div className="text-sm font-medium text-fg-primary">
        Проектов пока нет
      </div>
      <p className="max-w-md text-xs text-fg-tertiary">
        Создайте первый проект — выберите шаблон команды (отдел продаж,
        разработка, маркетинг) или начните с пустого.
      </p>
      <Button asChild size="sm" className="gap-2">
        <Link href="/projects/new">
          <Plus size={14} />
          Создать проект
        </Link>
      </Button>
    </div>
  );
}
