import type { Metadata } from 'next';

import { IncidentsClient } from './IncidentsClient';

export const metadata: Metadata = { title: 'Z-Admin — Инциденты' };

export default function AdminIncidentsPage() {
  return <IncidentsClient />;
}
