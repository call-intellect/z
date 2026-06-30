import type { Metadata } from 'next';

import { MasterChatHome } from './MasterChatHome';
import { TierGate } from '@/ui/components/TierGate';
import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileAskClient } from '@/ui/mobile/shared/MobileAskClient';

export const metadata: Metadata = {
  title: 'Помощник компании',
};

export default function ChatPage() {
  return (
    <TierGate feature="feature.chat_org">
      <MobileShell mobile={<MobileAskClient />} desktop={<MasterChatHome />} />
    </TierGate>
  );
}
