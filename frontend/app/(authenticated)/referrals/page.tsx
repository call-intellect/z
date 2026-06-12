import type { Metadata } from 'next';

import { SECTION_LABELS } from '@/lib/section-labels';

import { ReferralsClient } from './ReferralsClient';

export const metadata: Metadata = {
  title: SECTION_LABELS.referrals,
};

export default function ReferralsPage() {
  return <ReferralsClient />;
}
