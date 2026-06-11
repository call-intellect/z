import type { Metadata } from 'next';

import { EconomicsAnalyticsClient } from './EconomicsAnalyticsClient';

export const metadata: Metadata = {
  title: 'Юнит-экономика (аналитика)',
};

export default function EconomicsAnalyticsPage() {
  return <EconomicsAnalyticsClient />;
}
