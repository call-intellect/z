'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useCycles } from '@/hooks/tracker/useCycles';
import { CycleProgress } from '@/ui/tracker';

export function CyclesClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project, isLoading: pLoading } = useProjectBySlug(currentOrgId, slug);
  const { cycles, isLoading, error } = useCycles(currentOrgId, project?.id);

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
    return <div className="text-sm text-danger">Не удалось загрузить циклы.</div>;
  }

  if (!project) {
    return <div className="text-sm text-fg-tertiary">Проект не найден.</div>;
  }

  if (cycles.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
        В этом проекте ещё нет циклов.
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
