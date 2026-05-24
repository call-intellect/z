import type { Metadata } from 'next';

import { AdminWebhooksClient } from './AdminWebhooksClient';

export const metadata: Metadata = {
  title: 'Авто-уведомления — Z',
};

export default function AdminWebhooksPage() {
  return <AdminWebhooksClient />;
}
