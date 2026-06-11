import type { Metadata } from 'next';

import { ChatboxCustomersClient } from './ChatboxCustomersClient';

export const metadata: Metadata = {
  title: 'Клиенты и сотрудники — Чат бокс',
};

export default function ChatboxCustomersPage() {
  return <ChatboxCustomersClient />;
}
