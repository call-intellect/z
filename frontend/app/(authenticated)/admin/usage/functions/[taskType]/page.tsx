import { redirect } from 'next/navigation';

/**
 * Фаза 2 редизайна админки — миграция URL.
 *
 * `/admin/usage/functions/[taskType]` переехал в
 * `/admin/analytics/functions/[taskType]`. Сам клиент `FunctionDetailClient`
 * оставлен в файле рядом — на случай переиспользования.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  redirect(`/admin/analytics/functions/${encodeURIComponent(taskType)}`);
}
