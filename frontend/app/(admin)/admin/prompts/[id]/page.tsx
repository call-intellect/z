import type { Metadata } from 'next';

import { PromptDetailClient } from './PromptDetailClient';

export const metadata: Metadata = {
  title: 'Шаблон промпта — Управление',
};

export default async function AdminPromptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PromptDetailClient id={id} />;
}
