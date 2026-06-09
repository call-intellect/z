import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ProjectSettingsClient } from './ProjectSettingsClient';

export const metadata: Metadata = {
  title: 'Настройки проекта',
};

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <ProjectSettingsClient slug={slug} />
    </ProjectViewShell>
  );
}
