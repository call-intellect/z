import type { Metadata } from 'next';

import { GoalDetailClient } from './GoalDetailClient';

export const metadata: Metadata = {
  title: 'Цель',
};

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GoalDetailClient goalId={id} />;
}
