import type { Metadata } from 'next';

import { ComingSoonPage } from '@/ui/components/coming-soon/ComingSoonPage';

export const metadata: Metadata = {
  title: 'Процессы',
};

export default function ProcessesPage() {
  return <ComingSoonPage section="processes" />;
}
