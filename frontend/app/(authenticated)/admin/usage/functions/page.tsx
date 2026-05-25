import { redirect } from 'next/navigation';

/**
 * Фаза 2 редизайна админки — миграция URL.
 *
 * `/admin/usage/functions` переехал в `/admin/analytics/functions`. Сам
 * клиент `FunctionsClient` оставлен в файле рядом — на случай переиспользования.
 */
export default function Page() {
  redirect('/admin/analytics/functions');
}
