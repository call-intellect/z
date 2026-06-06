import type { Metadata } from 'next';

import { SprintsListClient } from './SprintsListClient';

export const metadata: Metadata = {
  title: 'Спринты — Кора',
};

export default function SprintsPage() {
  return <SprintsListClient />;
}
