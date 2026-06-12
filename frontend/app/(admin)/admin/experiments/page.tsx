import type { Metadata } from 'next';

import { ExperimentsListClient } from './ExperimentsListClient';

export const metadata: Metadata = { title: 'Эксперименты' };

export default function ExperimentsListPage() {
  return <ExperimentsListClient />;
}
