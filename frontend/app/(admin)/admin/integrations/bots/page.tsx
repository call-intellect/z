import type { Metadata } from 'next';

import { BotsClient } from './BotsClient';

export const metadata: Metadata = { title: 'Z-Admin — Conversational боты' };

export default function AdminBotsPage() {
  return <BotsClient />;
}
