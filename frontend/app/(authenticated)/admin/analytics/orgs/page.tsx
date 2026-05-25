import type { Metadata } from 'next';

import { OrgsAnalyticsClient } from './OrgsAnalyticsClient';

export const metadata: Metadata = { title: 'Z-Admin — Org и пользователи (аналитика)' };

export default function OrgsAnalyticsPage() {
  return <OrgsAnalyticsClient />;
}
