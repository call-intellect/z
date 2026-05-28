import type { Metadata } from 'next';

import { AdminSubscriptionClient } from './AdminSubscriptionClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Подписка',
};

/**
 * Server-обёртка `/admin/orgs/[id]/subscription` (super_admin).
 *
 * Управление подпиской Org: ручная активация (paid/bonus + reason),
 * adjust-seats, force-status, history событий.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.4 + §13.
 */
export default async function AdminOrgSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminSubscriptionClient tenantId={id} />;
}
