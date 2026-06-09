import type { Metadata } from 'next';

import { SprintsListClient } from './SprintsListClient';

export const metadata: Metadata = {
  title: 'Спринты',
};

export default function SprintsPage() {
  return <SprintsListClient />;
}
