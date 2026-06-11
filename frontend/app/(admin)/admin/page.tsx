import type { Metadata } from 'next';

import { AdminDashboardClient } from './AdminDashboardClient';

export const metadata: Metadata = { title: 'Дашборд' };

export default function AdminDashboardPage() {
  return <AdminDashboardClient />;
}
