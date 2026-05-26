import { redirect } from 'next/navigation';

/**
 * Legacy `/roles/[id]/clone` — после ТЗ 2026-05-26 канонический URL клона
 * переехал в `/clones/[roleId]`. Этот файл — перманентный редирект,
 * чтобы старые ссылки (письма, чат, история браузера) не ломались.
 */
export default function LegacyRoleClonePage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/clones/${encodeURIComponent(params.id)}`);
}
