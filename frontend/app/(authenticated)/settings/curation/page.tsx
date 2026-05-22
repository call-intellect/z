import type { Metadata } from 'next';

import { CurationSettingsClient } from './CurationSettingsClient';

export const metadata: Metadata = {
  title: 'Настройки проверки',
};

/**
 * `/settings/curation` — настройки Слоя 4 (SBA α-4).
 *
 * Для owner / admin Org: пороги triage'а, список «критических» типов,
 * срок жизни pending-карточки.
 */
export default function CurationSettingsPage() {
  return <CurationSettingsClient />;
}
