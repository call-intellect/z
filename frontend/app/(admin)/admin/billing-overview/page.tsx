import type { Metadata } from 'next';

import { AdminBillingOverviewClient } from './AdminBillingOverviewClient';

export const metadata: Metadata = {
  title: 'Биллинг overview',
};

export default function AdminBillingOverviewPage() {
  return <AdminBillingOverviewClient />;
}
