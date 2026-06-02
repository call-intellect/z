import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/admin/memory-access` — раздел переехал в
 * `/company-admin/memory-access` (ТЗ 2026-06-02). Редирект для совместимости.
 */
export default function MemoryAccessRedirectPage(): never {
  redirect('/company-admin/memory-access');
}
