import type { Metadata } from 'next';

import { IdeaDetailRouteClient } from './IdeaDetailRouteClient';

export const metadata: Metadata = {
  title: 'Идея',
};

export default async function IdeaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IdeaDetailRouteClient ideaId={id} />;
}
