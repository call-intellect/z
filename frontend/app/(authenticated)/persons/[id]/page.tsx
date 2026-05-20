import type { Metadata } from 'next';

import { PersonDetailClient } from './PersonDetailClient';

export const metadata: Metadata = {
  title: 'Персона',
};

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonDetailClient entityId={id} />;
}
