import type { Metadata } from 'next';

import { ComingSoonPage } from '@/ui/components/coming-soon/ComingSoonPage';

export const metadata: Metadata = {
  title: 'Регламенты',
};

export default function RegulationsPage() {
  return <ComingSoonPage section="regulations" />;
}
