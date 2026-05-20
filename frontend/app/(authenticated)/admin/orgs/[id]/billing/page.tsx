import type { Metadata } from 'next';

import { BillingAdminClient } from './BillingAdminClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Тариф Org',
};

/**
 * Server-обёртка над `<BillingAdminClient>`. Проверка super_admin происходит
 * внутри клиентского компонента (через apiClient + onForbidden state).
 */
export default async function AdminOrgBillingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BillingAdminClient tenantId={id} />;
}
