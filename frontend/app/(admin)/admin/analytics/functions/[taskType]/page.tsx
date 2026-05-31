import type { Metadata } from 'next';

import { FunctionDetailAnalyticsClient } from './FunctionDetailAnalyticsClient';

export const metadata: Metadata = { title: 'Z-Admin — Функция LLM (аналитика)' };

export default async function FunctionDetailAnalyticsPage({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  return <FunctionDetailAnalyticsClient taskType={taskType} />;
}
