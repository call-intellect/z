import type { Metadata } from 'next';

import { GlobalChannelsClient } from './GlobalChannelsClient';

export const metadata: Metadata = { title: 'Z-Admin — Глобальные каналы' };

export default function AdminGlobalChannelsPage() {
  return <GlobalChannelsClient />;
}
