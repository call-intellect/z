import type { Metadata } from 'next';

import { AdminBillingOverviewClient } from './AdminBillingOverviewClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Биллинг overview',
};

export default function AdminBillingOverviewPage() {
  return <AdminBillingOverviewClient />;
}
