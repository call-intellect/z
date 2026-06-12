import type { Metadata } from 'next';

import { OrgEconomicsDetailClient } from './OrgEconomicsDetailClient';

export const metadata: Metadata = { title: 'Org Юнит-экономика' };

export default async function OrgEconomicsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrgEconomicsDetailClient tenantId={id} />;
}
