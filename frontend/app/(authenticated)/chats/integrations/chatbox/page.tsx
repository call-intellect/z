import type { Metadata } from 'next';

import { ChatboxIntegrationClient } from './ChatboxIntegrationClient';

export const metadata: Metadata = {
  title: 'Интеграция с Чат боксом',
};

export default function ChatboxIntegrationPage() {
  return <ChatboxIntegrationClient />;
}
