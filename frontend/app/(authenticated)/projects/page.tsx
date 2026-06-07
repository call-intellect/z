import type { Metadata } from 'next';

import { ProjectsListClient } from './ProjectsListClient';

export const metadata: Metadata = {
  title: 'Проекты',
};

export default function ProjectsPage() {
  return <ProjectsListClient />;
}
