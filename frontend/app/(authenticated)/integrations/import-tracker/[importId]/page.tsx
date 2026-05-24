import type { Metadata } from 'next';

import { ImportDetailClient } from './ImportDetailClient';

export const metadata: Metadata = {
  title: 'Импорт — Z',
};

interface PageProps {
  params: { importId: string };
}

/**
 * `/integrations/import-tracker/:importId` — детальная страница импорта
 * (Wave 3 / Tracker Phase 5 part 1). Прогресс + ошибки + отмена.
 */
export default function ImportDetailPage({ params }: PageProps) {
  return <ImportDetailClient importLogId={params.importId} />;
}
