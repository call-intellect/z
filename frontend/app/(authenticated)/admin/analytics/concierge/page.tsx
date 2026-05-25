import type { Metadata } from 'next';

import { ConciergeAnalyticsClient } from './ConciergeAnalyticsClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Concierge и AI-чат (аналитика)',
};

export default function ConciergeAnalyticsPage() {
  return <ConciergeAnalyticsClient />;
}
