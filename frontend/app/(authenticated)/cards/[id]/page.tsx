import type { Metadata } from 'next';

import { CardDetailClient } from './CardDetailClient';

export const metadata: Metadata = {
  title: 'Карточка',
};

export default function CardDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <CardDetailClient cardId={params.id} />;
}
