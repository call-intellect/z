import type { Metadata } from 'next';

import { PlansClient } from './PlansClient';

export const metadata: Metadata = { title: 'Тариф · Z-Admin' };

export default function AdminPlansPage() {
  return <PlansClient />;
}
