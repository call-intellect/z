import type { Metadata } from 'next';

import { HealthClient } from './HealthClient';

export const metadata: Metadata = { title: 'Z-Admin — Здоровье' };

export default function HealthPage() {
  return <HealthClient />;
}
