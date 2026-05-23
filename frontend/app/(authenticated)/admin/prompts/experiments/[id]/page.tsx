import type { Metadata } from 'next';

import { PromptExperimentDetailClient } from './PromptExperimentDetailClient';

export const metadata: Metadata = {
  title: 'Эксперимент — Управление',
};

export default async function AdminPromptExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PromptExperimentDetailClient experimentId={id} />;
}
