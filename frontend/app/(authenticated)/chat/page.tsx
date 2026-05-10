import type { Metadata } from 'next';

import { ChatClient } from './ChatClient';

export const metadata: Metadata = {
  title: 'AI-чат',
};

export default function ChatPage() {
  return <ChatClient />;
}
