import type { Metadata } from 'next';

import { SECTION_LABELS } from '@/lib/section-labels';

import { RegulationsListClient } from './RegulationsListClient';

export const metadata: Metadata = {
  title: SECTION_LABELS.regulations,
};

/**
 * `/regulations` — единый master-detail для Regulation / Process / Policy
 * (SBA α-7). Фильтр `kind` показывает соответствующий тип записей.
 *
 * Первая видимая ценность Слоя 3: «у компании появились регламенты сами
 * собой» — генерируются Specialist'ом 3.1 из встреч с провенансом до цитаты.
 */
export default function RegulationsPage() {
  return <RegulationsListClient />;
}
