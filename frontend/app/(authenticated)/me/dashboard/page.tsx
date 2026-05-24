import type { Metadata } from 'next';

import { MyDashboardClient } from './MyDashboardClient';

export const metadata: Metadata = {
  title: 'Личный дашборд — Z',
};

export default function MyDashboardPage() {
  return <MyDashboardClient />;
}
