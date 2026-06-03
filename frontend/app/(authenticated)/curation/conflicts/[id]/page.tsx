import type { Metadata } from 'next';

import { ConflictDetailClient } from './ConflictDetailClient';

export const metadata: Metadata = {
  title: 'Конфликт',
};

/**
 * `/curation/conflicts/[id]` — detail-страница одного конфликта канонизации
 * (SBA, Фаза C3). Доступ только владельцу/администратору Org (плюс super-admin).
 * Слои api/domain/backend переиспользуются как есть.
 */
export default async function ConflictDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConflictDetailClient conflictId={id} />;
}
