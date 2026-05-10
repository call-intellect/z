import type { Metadata } from 'next';

import { BillingAdminClient } from './BillingAdminClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Тариф Org',
};

/**
 * Server-обёртка над `<BillingAdminClient>`. Проверка super_admin происходит
 * внутри клиентского компонента (через apiClient + onForbidden state).
 */
export default function AdminOrgBillingPage({
  params,
}: {
  params: { id: string };
}) {
  return <BillingAdminClient tenantId={params.id} />;
}
