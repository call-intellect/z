import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ProjectDocumentsClient } from './ProjectDocumentsClient';

export const metadata: Metadata = {
  title: 'Документы проекта — Z',
};

export default function ProjectDocumentsPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <ProjectDocumentsClient slug={params.slug} />
    </ProjectViewShell>
  );
}
