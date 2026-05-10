import type { Metadata } from 'next';

import { AdminDashboardClient } from './AdminDashboardClient';

export const metadata: Metadata = { title: 'Z-Admin — Дашборд' };

export default function AdminDashboardPage() {
  return <AdminDashboardClient />;
}
