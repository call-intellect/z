import type { Metadata } from 'next';

import { ComingSoonPage } from '@/ui/components/coming-soon/ComingSoonPage';

export const metadata: Metadata = {
  title: 'Политики',
};

export default function PoliciesPage() {
  return <ComingSoonPage section="policies" />;
}
