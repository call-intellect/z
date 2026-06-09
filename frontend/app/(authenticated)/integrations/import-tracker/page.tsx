import type { Metadata } from 'next';

import { ImportTrackerClient } from './ImportTrackerClient';

export const metadata: Metadata = {
  title: 'Импорт задач из других трекеров',
};

/**
 * `/integrations/import-tracker` — wizard миграционного импорта
 * (Wave 3 / Tracker Phase 5 part 1).
 *
 * Page-компонент — только роутинг и метаданные; вся логика — в client.
 */
export default function ImportTrackerPage() {
  return <ImportTrackerClient />;
}
