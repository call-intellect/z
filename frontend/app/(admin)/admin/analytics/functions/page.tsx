import type { Metadata } from 'next';

import { FunctionsAnalyticsClient } from './FunctionsAnalyticsClient';

export const metadata: Metadata = { title: 'Функции LLM (аналитика)' };

export default function FunctionsAnalyticsPage() {
  return <FunctionsAnalyticsClient />;
}
