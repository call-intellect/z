'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useTeamTemplates } from '@/hooks/tracker/useTeamTemplates';

/**
 * `/team-templates` — каталог шаблонов команд (sales / dev / marketing / …).
 * Phase 1 backend — read-only. POST /projects/from-template вернёт 501
 * до Sprint 9.
 */
export function TeamTemplatesClient() {
  const { currentOrgId } = useAuth();
  const { templates, isLoading, error } = useTeamTemplates(currentOrgId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
          <Users size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Шаблоны команд
          </h1>
          <p className="text-sm text-fg-tertiary">
            Готовые наборы статусов, ролей и метрик для типовых команд
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить шаблоны.
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
          Системные шаблоны команд появятся в Sprint 9.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/team-templates/${encodeURIComponent(t.slug)}`}
                className="flex h-full flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4 transition-colors hover:border-border hover:bg-bg-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg-primary">
                    {t.name}
                  </span>
                  <span className="text-[10px] uppercase text-fg-tertiary">
                    {t.category}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-fg-tertiary">
                  {t.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
