import type { Metadata } from 'next';

import { ExperimentClient } from './ExperimentClient';

export const metadata: Metadata = { title: 'Z-Admin — Эксперимент' };

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  return <ExperimentClient taskType={taskType} />;
}
