import type { Metadata } from 'next';

import { ChatDetailClient } from './ChatDetailClient';

export const metadata: Metadata = {
  title: 'Чат клиента',
};

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatDetailClient chatId={id} />;
}
