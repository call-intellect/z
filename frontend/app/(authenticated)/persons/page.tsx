import type { Metadata } from 'next';

import { PersonsListClient } from './PersonsListClient';

export const metadata: Metadata = {
  title: 'Персоны',
};

export default function PersonsPage() {
  return <PersonsListClient />;
}
