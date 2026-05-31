import type { Metadata } from 'next';

import { SystemMessagesClient } from './SystemMessagesClient';

export const metadata: Metadata = { title: 'Z-Admin — Системные сообщения' };

export default function AdminSystemMessagesPage() {
  return <SystemMessagesClient />;
}
