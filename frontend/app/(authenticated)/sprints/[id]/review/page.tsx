import type { Metadata } from 'next';

import { SprintReviewClient } from './SprintReviewClient';

export const metadata: Metadata = {
  title: 'Итоги спринта — Z',
};

export default function SprintReviewPage({
  params,
}: {
  params: { id: string };
}) {
  return <SprintReviewClient cycleId={params.id} />;
}
