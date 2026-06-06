import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { ChatV2Client } from './ChatV2Client';

export const metadata: Metadata = {
  title: 'Помощник компании — Кора',
};

export default function ChatV2Page(): ReactElement {
  return <ChatV2Client />;
}
