import type { Metadata } from 'next';

import { ConciergeAnalyticsClient } from './ConciergeAnalyticsClient';

export const metadata: Metadata = {
  title: 'Мастер и ИИ-чат (аналитика)',
};

export default function ConciergeAnalyticsPage() {
  return <ConciergeAnalyticsClient />;
}
