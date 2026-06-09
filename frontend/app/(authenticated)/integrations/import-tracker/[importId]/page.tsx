import type { Metadata } from 'next';

import { ImportDetailClient } from './ImportDetailClient';

export const metadata: Metadata = {
  title: 'Импорт',
};

interface PageProps {
  params: Promise<{ importId: string }>;
}

/**
 * `/integrations/import-tracker/:importId` — детальная страница импорта
 * (Wave 3 / Tracker Phase 5 part 1). Прогресс + ошибки + отмена.
 */
export default async function ImportDetailPage({ params }: PageProps) {
  const { importId } = await params;
  return <ImportDetailClient importLogId={importId} />;
}
