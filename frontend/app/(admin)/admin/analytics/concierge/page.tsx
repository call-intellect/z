import type { Metadata } from 'next';

import { ConciergeAnalyticsClient } from './ConciergeAnalyticsClient';

export const metadata: Metadata = {
  title: 'Concierge и AI-чат (аналитика)',
};

export default function ConciergeAnalyticsPage() {
  return <ConciergeAnalyticsClient />;
}
