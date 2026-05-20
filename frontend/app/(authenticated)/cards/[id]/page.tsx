import type { Metadata } from 'next';

import { CardDetailClient } from './CardDetailClient';

export const metadata: Metadata = {
  title: 'Карточка',
};

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CardDetailClient cardId={id} />;
}
