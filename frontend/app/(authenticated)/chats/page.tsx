import type { Metadata } from 'next';

import { ChatsListClient } from './ChatsListClient';

export const metadata: Metadata = {
  title: 'Чаты клиентов',
};

export default function ChatsPage() {
  return <ChatsListClient />;
}
