'use client';

import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useProjects } from '@/hooks/tracker/useProjects';

/**
 * `/admin/projects` — расширенный список всех проектов организации (включая
 * архивные / удалённые). Для admin / owner.
 */
export function AdminProjectsClient() {
  const { currentOrgId } = useAuth();
  const { projects, total, isLoading } = useProjects(currentOrgId, {
    includeArchived: true,
    limit: 100,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
          <FolderKanban size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Все проекты организации
          </h1>
          <p className="text-sm text-fg-tertiary">
            Включая архивные · всего {total}
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-fg-tertiary">
            <tr className="border-b border-border-subtle">
              <th className="py-2 pr-3">Идентификатор</th>
              <th className="py-2 pr-3">Название</th>
              <th className="py-2 pr-3">Slug</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2 pr-3">Создан</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border-subtle/50">
                <td className="py-2 pr-3 font-mono text-xs text-fg-secondary">
                  {p.identifier}
                </td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/projects/${encodeURIComponent(p.slug)}/board`}
                    className="text-accent hover:underline"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-fg-tertiary">
                  {p.slug}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {p.archivedAt ? 'Архив' : 'Активен'}
                </td>
                <td className="py-2 pr-3 text-xs text-fg-tertiary">
                  {p.createdAt.toLocaleDateString('ru-RU')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
