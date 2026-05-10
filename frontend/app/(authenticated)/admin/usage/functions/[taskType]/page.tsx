import type { Metadata } from 'next';

import { FunctionDetailClient } from './FunctionDetailClient';

export const metadata: Metadata = { title: 'Z-Admin — Функция LLM' };

export default function FunctionDetailPage({
  params,
}: {
  params: { taskType: string };
}) {
  return <FunctionDetailClient taskType={params.taskType} />;
}
