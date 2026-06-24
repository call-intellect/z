import type { Metadata } from 'next';

import { ChatboxChatsListClient } from './ChatboxChatsListClient';

export const metadata: Metadata = {
  title: 'Диалоги ChatBox',
};

export default function ChatboxChatsListPage() {
  return <ChatboxChatsListClient />;
}
