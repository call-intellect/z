import { redirect } from 'next/navigation';

/**
 * `/settings/admin/sources` — устаревший путь (Фаза 7-заглушка).
 *
 * В Фазе 10 управление источниками переехало в `/settings/sources`
 * (доступно owner/admin Org без `/admin` префикса). Старые ссылки
 * редиректим, чтобы не плодить дубль.
 */
export default function SettingsAdminSourcesRedirect(): never {
  redirect('/settings/sources');
}
