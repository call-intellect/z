'use client';

import { use } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { ProjectViewShell } from '../ProjectViewShell';
import { IntakeBoard } from '@/ui/tracker';

export default function ProjectIntakePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { currentOrgId } = useAuth();
  const { project } = useProjectBySlug(currentOrgId, slug);

  return (
    <ProjectViewShell slug={slug}>
      {currentOrgId && project ? (
        <IntakeBoard orgId={currentOrgId} />
      ) : (
        <div className="text-sm text-fg-tertiary">Загружаем проект…</div>
      )}
    </ProjectViewShell>
  );
}
