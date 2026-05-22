import type { Metadata } from 'next';

import { CurationQueueClient } from './CurationQueueClient';

export const metadata: Metadata = {
  title: 'Проверка карточек',
};

/**
 * `/curation` — центральная очередь Слоя 4 (SBA α-4).
 *
 * Master-detail: слева — список CurationItem, справа — детальная карточка с
 * payload'ом, провенансом, связанными конфликтами и кнопками решения.
 */
export default function CurationPage() {
  return <CurationQueueClient />;
}
