import type { Metadata } from 'next';

import { FunctionDetailClient } from './FunctionDetailClient';

export const metadata: Metadata = { title: 'Z-Admin — Функция LLM' };

export default async function FunctionDetailPage({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  return <FunctionDetailClient taskType={taskType} />;
}
