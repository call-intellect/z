import type { Metadata } from 'next';

import { OrgUsageClient } from './OrgUsageClient';

export const metadata: Metadata = { title: 'Org-Admin — Экономика' };

export default function OrgUsagePage() {
  return <OrgUsageClient />;
}
