import type { Metadata } from 'next';

import { OrgEconomicsDetailClient } from './OrgEconomicsDetailClient';

export const metadata: Metadata = { title: 'Z-Admin — Org Юнит-экономика' };

export default function OrgEconomicsDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <OrgEconomicsDetailClient tenantId={params.id} />;
}
