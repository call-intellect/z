import type { Metadata } from 'next';

import { BotsClient } from './BotsClient';

export const metadata: Metadata = { title: 'Conversational боты' };

export default function AdminBotsPage() {
  return <BotsClient />;
}
