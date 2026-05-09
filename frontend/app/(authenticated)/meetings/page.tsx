import { MeetingsTable } from '@/ui/components/meetings-list/MeetingsTable';

/**
 * Защита роута: middleware (frontend/middleware.ts) проверяет наличие
 * cookie `z_session`. Если cookie нет — редиректит на `/`.
 *
 * Внутри страницы мы дополнительно полагаемся на `apiClient`, который
 * на 401 эмитит `auth:expired` — `AuthProvider` сбросит user и UI прекратит
 * запросы.
 */
export default function MeetingsListPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <MeetingsTable />
    </main>
  );
}
