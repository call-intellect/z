import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/sources` — раздел «Источники» переехал в
 * `/company-admin/sources` (ТЗ 2026-06-02). Редирект для совместимости.
 */
export default function SettingsSourcesRedirectPage(): never {
  redirect('/company-admin/sources');
}
