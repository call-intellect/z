import type { Metadata } from 'next';

import { SprintReviewClient } from './SprintReviewClient';

export const metadata: Metadata = {
  title: 'Итоги спринта — Z',
};

export default async function SprintReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SprintReviewClient cycleId={id} />;
}
