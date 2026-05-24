'use client';

import { useAuth } from '@/contexts/auth-context';
import { useTeamTemplate } from '@/hooks/tracker/useTeamTemplates';

export function TeamTemplateDetailClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { template, isLoading, error } = useTeamTemplate(currentOrgId, slug);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
        <div className="text-sm text-danger">Шаблон не найден.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <header>
        <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
          {template.category}
        </span>
        <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
          {template.name}
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">{template.description}</p>
      </header>

      <section className="rounded-md border border-border-subtle bg-bg-elevated p-4">
        <h2 className="mb-2 text-sm font-medium text-fg-primary">Структура</h2>
        <pre className="overflow-x-auto rounded bg-bg-overlay/40 p-3 text-xs text-fg-secondary">
          {JSON.stringify(template.definition, null, 2)}
        </pre>
      </section>

      <p className="text-xs text-fg-tertiary">
        Создание проекта из этого шаблона появится в Sprint 9.
      </p>
    </div>
  );
}
