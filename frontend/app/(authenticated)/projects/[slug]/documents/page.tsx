import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ProjectDocumentsClient } from './ProjectDocumentsClient';

export const metadata: Metadata = {
  title: 'Документы проекта — Кора',
};

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <ProjectDocumentsClient slug={slug} />
    </ProjectViewShell>
  );
}
