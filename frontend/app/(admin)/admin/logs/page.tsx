import type { Metadata } from 'next';

import { LogsClient } from './LogsClient';

export const metadata: Metadata = { title: 'Технические логи' };

export default function AdminLogsPage() {
  return <LogsClient />;
}
