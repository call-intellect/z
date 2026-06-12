import type { Metadata } from 'next';

import { GlobalChannelsClient } from './GlobalChannelsClient';

export const metadata: Metadata = { title: 'Глобальные каналы' };

export default function AdminGlobalChannelsPage() {
  return <GlobalChannelsClient />;
}
