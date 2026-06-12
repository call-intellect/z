import type { Metadata } from 'next';

import { MeetingsAnalyticsClient } from './MeetingsAnalyticsClient';

export const metadata: Metadata = { title: 'Встречи (аналитика)' };

export default function MeetingsAnalyticsPage() {
  return <MeetingsAnalyticsClient />;
}
