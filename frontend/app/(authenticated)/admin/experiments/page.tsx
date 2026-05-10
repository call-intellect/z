import type { Metadata } from 'next';

import { ExperimentsListClient } from './ExperimentsListClient';

export const metadata: Metadata = { title: 'Z-Admin — Эксперименты' };

export default function ExperimentsListPage() {
  return <ExperimentsListClient />;
}
