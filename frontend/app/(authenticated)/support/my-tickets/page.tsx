import type { Metadata } from 'next';

import { MyTicketsClient } from './MyTicketsClient';

export const metadata: Metadata = {
  title: 'Мои обращения',
};

/**
 * `/support/my-tickets` — список обращений пользователя в службу поддержки
 * (ТЗ 2026-06-09 support-desk Ф1).
 *
 * Серверная обёртка: заголовок + клиентский список (useMyTickets).
 */
export default function MyTicketsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Мои обращения</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Здесь видны все ваши обращения в службу поддержки и ответы команды.
        </p>
      </header>

      <MyTicketsClient />
    </main>
  );
}
