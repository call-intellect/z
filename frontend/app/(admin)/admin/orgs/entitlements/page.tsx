import type { Metadata } from 'next';

import { EntitlementsOverviewClient } from './EntitlementsOverviewClient';

export const metadata: Metadata = { title: 'Entitlements' };

export default function AdminEntitlementsPage() {
  return <EntitlementsOverviewClient />;
}
