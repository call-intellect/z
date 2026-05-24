import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ProjectSettingsClient } from './ProjectSettingsClient';

export const metadata: Metadata = {
  title: 'Настройки проекта — Z',
};

export default function ProjectSettingsPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <ProjectSettingsClient slug={params.slug} />
    </ProjectViewShell>
  );
}
