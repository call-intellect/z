import type { Metadata } from 'next';

import { DocumentDetailClient } from './DocumentDetailClient';

export const metadata: Metadata = {
  title: 'Документ — Кора',
};

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentDetailClient documentId={id} />;
}
