import type { Metadata } from 'next';

import { GoalDetailClient } from './GoalDetailClient';

export const metadata: Metadata = {
  title: 'Цель',
};

export default function GoalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <GoalDetailClient goalId={params.id} />;
}
