import type { Metadata } from 'next';

import { LiveKitClient } from './LiveKitClient';

export const metadata: Metadata = { title: 'LiveKit health' };

export default function AdminLiveKitPage() {
  return <LiveKitClient />;
}
