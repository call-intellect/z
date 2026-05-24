'use client';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { ProjectViewShell } from '../ProjectViewShell';
import { IntakeBoard } from '@/ui/tracker';

export default function ProjectIntakePage({
  params,
}: {
  params: { slug: string };
}) {
  const { currentOrgId } = useAuth();
  const { project } = useProjectBySlug(currentOrgId, params.slug);

  return (
    <ProjectViewShell slug={params.slug}>
      {currentOrgId && project ? (
        <IntakeBoard orgId={currentOrgId} />
      ) : (
        <div className="text-sm text-fg-tertiary">Загружаем проект…</div>
      )}
    </ProjectViewShell>
  );
}
