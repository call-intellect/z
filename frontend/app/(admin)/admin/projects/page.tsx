import type { Metadata } from 'next';

import { AdminProjectsClient } from './AdminProjectsClient';

export const metadata: Metadata = {
  title: 'Проекты (админка) — Кора',
};

export default function AdminProjectsPage() {
  return <AdminProjectsClient />;
}
