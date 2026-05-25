import type { Metadata } from 'next';

import { FunctionsAnalyticsClient } from './FunctionsAnalyticsClient';

export const metadata: Metadata = { title: 'Z-Admin — Функции LLM (аналитика)' };

export default function FunctionsAnalyticsPage() {
  return <FunctionsAnalyticsClient />;
}
