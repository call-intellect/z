import type { Metadata } from 'next';

import { DeskTicketDetailClient } from './DeskTicketDetailClient';

export const metadata: Metadata = {
  title: 'Поддержка — тикет',
};

/**
 * `/support/desk/[id]` — детали тикета для сотрудника поддержки: вся лента
 * (internal+external), ответ клиенту, внутренняя заметка, назначение,
 * смена статуса (ТЗ 2026-06-09 support-desk Ф1). Доступ гейтится isAgent.
 */
export default async function DeskTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <DeskTicketDetailClient ticketId={id} />
    </main>
  );
}
