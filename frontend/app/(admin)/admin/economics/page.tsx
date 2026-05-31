import { redirect } from 'next/navigation';

/**
 * Фаза 2 редизайна админки — миграция URL.
 *
 * `/admin/economics` переехал в `/admin/analytics/economics`. Drill-down
 * `/admin/economics/orgs/[id]` остаётся на месте — это управление, не аналитика.
 * Сам клиент `EconomicsClient` оставлен в файле рядом — на случай переиспользования.
 */
export default function Page() {
  redirect('/admin/analytics/economics');
}
