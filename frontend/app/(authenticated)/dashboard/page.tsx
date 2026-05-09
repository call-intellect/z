import type { Metadata } from 'next';

import { DashboardClient } from './DashboardClient';

export const metadata: Metadata = {
  title: 'Главная — Z',
};

export default function DashboardPage() {
  return <DashboardClient />;
}
