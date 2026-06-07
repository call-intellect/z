import type { Metadata } from 'next';

import { ChatV2Client } from '../chat-v2/ChatV2Client';
import { TierGate } from '@/ui/components/TierGate';

export const metadata: Metadata = {
  title: 'Помощник компании',
};

export default function ChatPage() {
  return (
    <TierGate feature="feature.chat_org">
      <ChatV2Client />
    </TierGate>
  );
}
