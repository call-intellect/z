import type { Metadata } from 'next';

import { EconomicsClient } from './EconomicsClient';

export const metadata: Metadata = { title: 'Z-Admin — Юнит-экономика' };

export default function EconomicsPage() {
  return <EconomicsClient />;
}
