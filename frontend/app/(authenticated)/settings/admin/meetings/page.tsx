import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/admin/meetings` — раздел переехал в
 * `/company-admin/meetings` (ТЗ 2026-06-02). Редирект для совместимости.
 */
export default function MeetingsAdminRedirectPage(): never {
  redirect('/company-admin/meetings');
}
