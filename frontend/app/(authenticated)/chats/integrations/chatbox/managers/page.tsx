import type { Metadata } from 'next';

import { ChatboxManagersClient } from './ChatboxManagersClient';

export const metadata: Metadata = {
  title: 'Менеджеры и сотрудники — Чат бокс',
};

export default function ChatboxManagersPage() {
  return <ChatboxManagersClient />;
}
