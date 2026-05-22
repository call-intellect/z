import type { Metadata } from 'next';

import { DocumentDetailClient } from './DocumentDetailClient';

export const metadata: Metadata = {
  title: 'Документ — Z',
};

export default function DocumentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <DocumentDetailClient documentId={params.id} />;
}
