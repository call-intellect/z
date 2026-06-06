import { redirect } from 'next/navigation';

/**
 * Legacy `/roles/[id]/clone` — после ТЗ 2026-05-26 канонический URL клона
 * переехал в `/clones/[roleId]`. Этот файл — перманентный редирект,
 * чтобы старые ссылки (письма, чат, история браузера) не ломались.
 */
export default async function LegacyRoleClonePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clones/${encodeURIComponent(id)}`);
}
