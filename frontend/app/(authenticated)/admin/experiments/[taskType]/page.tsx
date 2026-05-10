import type { Metadata } from 'next';

import { ExperimentClient } from './ExperimentClient';

export const metadata: Metadata = { title: 'Z-Admin — Эксперимент' };

export default function ExperimentPage({
  params,
}: {
  params: { taskType: string };
}) {
  return <ExperimentClient taskType={params.taskType} />;
}
