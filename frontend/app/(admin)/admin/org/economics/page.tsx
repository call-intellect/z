import type { Metadata } from 'next';

import { OrgEconomicsCurrentClient } from './OrgEconomicsCurrentClient';

export const metadata: Metadata = { title: 'Юнит-экономика Org' };

export default function OrgEconomicsCurrentPage() {
  return <OrgEconomicsCurrentClient />;
}
