import type { Metadata } from 'next';

import { KnowledgeAnalyticsClient } from './KnowledgeAnalyticsClient';

export const metadata: Metadata = {
  title: 'Knowledge-Core (аналитика)',
};

export default function KnowledgeAnalyticsPage() {
  return <KnowledgeAnalyticsClient />;
}
