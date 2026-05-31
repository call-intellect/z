import type { Metadata } from 'next';

import { PlansClient } from './PlansClient';

export const metadata: Metadata = { title: 'Z-Admin — Тарифы' };

export default function AdminPlansPage() {
  return <PlansClient />;
}
