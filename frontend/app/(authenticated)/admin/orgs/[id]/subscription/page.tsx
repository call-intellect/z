import { redirect } from 'next/navigation';

/**
 * Server-обёртка `/admin/orgs/[id]/subscription` (legacy URL).
 *
 * После Фазы 1 ТЗ admin-subscription-ui-v2 (2026-05-29) standalone-страница
 * редиректит в таб `?tab=subscription` карточки Org. Старые закладки
 * super-admin продолжают работать.
 */
export default async function AdminOrgSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/orgs/${encodeURIComponent(id)}?tab=subscription`);
}
