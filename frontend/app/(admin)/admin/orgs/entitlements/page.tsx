import type { Metadata } from 'next';

import { EntitlementsOverviewClient } from './EntitlementsOverviewClient';

export const metadata: Metadata = { title: 'Z-Admin — Entitlements' };

export default function AdminEntitlementsPage() {
  return <EntitlementsOverviewClient />;
}
