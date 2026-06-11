import type { Metadata } from 'next';

import { OrgsAnalyticsClient } from './OrgsAnalyticsClient';

export const metadata: Metadata = { title: 'Org и пользователи (аналитика)' };

export default function OrgsAnalyticsPage() {
  return <OrgsAnalyticsClient />;
}
