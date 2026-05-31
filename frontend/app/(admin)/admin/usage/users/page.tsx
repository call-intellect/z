import { redirect } from 'next/navigation';

/**
 * Фаза 2 редизайна админки — миграция URL.
 *
 * `/admin/usage/users` теперь объединён с разделом «Org и пользователи»
 * под `/admin/analytics/orgs`. Сам клиент `UsersUsageClient` оставлен в
 * файле рядом — на случай переиспользования из других мест.
 */
export default function Page() {
  redirect('/admin/analytics/orgs');
}
