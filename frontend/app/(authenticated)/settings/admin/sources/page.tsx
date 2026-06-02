import { redirect } from 'next/navigation';

/**
 * `/settings/admin/sources` — устаревший путь.
 *
 * Управление источниками переехало в `/company-admin/sources`
 * (ТЗ 2026-06-02). Старые ссылки редиректим, чтобы не плодить дубль.
 */
export default function SettingsAdminSourcesRedirect(): never {
  redirect('/company-admin/sources');
}
