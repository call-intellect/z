import type { Metadata } from 'next';

import { ExperimentsClient } from './ExperimentsClient';

export const metadata: Metadata = {
  title: 'A/B-эксперименты моделей — Admin',
};

export default function ExperimentsPage() {
  return <ExperimentsClient />;
}
