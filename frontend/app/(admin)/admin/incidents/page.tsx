import type { Metadata } from 'next';

import { IncidentsClient } from './IncidentsClient';

export const metadata: Metadata = { title: 'Инциденты' };

export default function AdminIncidentsPage() {
  return <IncidentsClient />;
}
