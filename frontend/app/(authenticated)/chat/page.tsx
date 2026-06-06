import type { Metadata } from 'next';

import { ChatClient } from './ChatClient';

export const metadata: Metadata = {
  title: 'Помощник компании — Кора',
};

export default function ChatPage() {
  return <ChatClient />;
}
