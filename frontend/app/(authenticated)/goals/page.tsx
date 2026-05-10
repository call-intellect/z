import type { Metadata } from 'next';

import { TierGate } from '@/ui/components/TierGate';

import { GoalsClient } from './GoalsClient';

export const metadata: Metadata = {
  title: 'Цели',
};

export default function GoalsPage() {
  return (
    <TierGate feature="feature.goals_strategy">
      <GoalsClient />
    </TierGate>
  );
}
