import type { Metadata } from 'next';

import { CurationDetailClient } from './CurationDetailClient';

export const metadata: Metadata = {
  title: 'Карточка курации',
};

/**
 * `/curation/[id]` — detail-страница одной карточки курации (SBA, Фаза C3).
 *
 * Открывается из напоминаний / колокольчика (раньше «Открыть» вело на общую
 * очередь `/curation`). Здесь куратор видит конкретный CurationItem и принимает
 * решение. Слои api/domain/backend переиспользуются как есть.
 */
export default async function CurationItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CurationDetailClient itemId={id} />;
}
