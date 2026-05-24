'use client';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectMembers } from '@/hooks/tracker/useProject';
import { AssigneeAvatar } from '@/ui/tracker';
import { PROJECT_MEMBER_ROLE_LABELS } from '@/domain/tracker';

export function ProjectSettingsClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project, isLoading } = useProjectBySlug(currentOrgId, slug);
  const { members } = useProjectMembers(currentOrgId, project?.id);

  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    );
  }

  if (!project) {
    return <div className="text-sm text-fg-tertiary">Проект не найден.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-primary">Основное</h2>
        <dl className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm md:grid-cols-2">
          <Field label="Название" value={project.name} />
          <Field label="Slug" value={project.slug} />
          <Field label="Идентификатор" value={project.identifier} />
          <Field label="Таймзона" value={project.timezone} />
          <Field
            label="Циклы"
            value={project.cycleViewEnabled ? 'Вкл' : 'Выкл'}
          />
          <Field
            label="Входящие"
            value={project.intakeViewEnabled ? 'Вкл' : 'Выкл'}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-primary">
          Участники · {members.length}
        </h2>
        {members.length === 0 ? (
          <div className="text-sm text-fg-tertiary">Участников нет.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
              >
                <AssigneeAvatar userId={m.userId} size={28} />
                <span className="flex-1 truncate font-mono text-xs text-fg-secondary">
                  {m.userId}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {PROJECT_MEMBER_ROLE_LABELS[m.role as 5 | 15 | 20] ?? m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-tertiary">
          Добавление/удаление участников появится в Sprint 3.
        </p>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </dt>
      <dd className="text-sm text-fg-primary">{value}</dd>
    </div>
  );
}
