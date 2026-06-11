import type { Metadata } from 'next';

import { HealthClient } from './HealthClient';

export const metadata: Metadata = { title: 'Здоровье' };

export default function HealthPage() {
  return <HealthClient />;
}
