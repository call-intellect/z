import type { Metadata } from 'next';

import { PromptDetailClient } from './PromptDetailClient';

export const metadata: Metadata = {
  title: 'Шаблон промпта — Управление',
};

export default function AdminPromptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <PromptDetailClient id={params.id} />;
}
