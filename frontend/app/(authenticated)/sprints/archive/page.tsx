import type { Metadata } from 'next';

import { SprintArchiveClient } from './SprintArchiveClient';

export const metadata: Metadata = {
  title: 'Архив спринтов — Кора',
};

export default function SprintsArchivePage() {
  return <SprintArchiveClient />;
}
