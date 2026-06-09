import type { Metadata } from 'next';

import { MyTicketDetailClient } from './MyTicketDetailClient';

export const metadata: Metadata = {
  title: 'Обращение',
};

/**
 * `/support/my-tickets/[id]` — детали обращения клиента: тема, статус, лента
 * видимых сообщений, ответ, CSAT-оценка после закрытия (ТЗ 2026-06-09
 * support-desk Ф1).
 */
export default async function MyTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <MyTicketDetailClient ticketId={id} />
    </main>
  );
}
