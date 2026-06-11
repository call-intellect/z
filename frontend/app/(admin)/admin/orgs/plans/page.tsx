import type { Metadata } from 'next';

import { PlansClient } from './PlansClient';

export const metadata: Metadata = { title: 'Тариф' };

export default function AdminPlansPage() {
  return <PlansClient />;
}
