import type { Metadata } from 'next';

import { ComingSoonPage } from '@/ui/components/coming-soon/ComingSoonPage';

export const metadata: Metadata = {
  title: 'Метрики',
};

export default function MetricsPage() {
  return <ComingSoonPage section="metrics" />;
}
