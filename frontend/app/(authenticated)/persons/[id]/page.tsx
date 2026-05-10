import type { Metadata } from 'next';

import { PersonDetailClient } from './PersonDetailClient';

export const metadata: Metadata = {
  title: 'Персона',
};

export default function PersonDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <PersonDetailClient entityId={params.id} />;
}
