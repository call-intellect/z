import type { Metadata } from 'next';

import { TierGate } from '@/ui/components/TierGate';

import { ThemesClient } from './ThemesClient';

export const metadata: Metadata = {
  title: 'Темы',
};

export default function ThemesPage() {
  return (
    <TierGate feature="feature.theme">
      <ThemesClient />
    </TierGate>
  );
}
