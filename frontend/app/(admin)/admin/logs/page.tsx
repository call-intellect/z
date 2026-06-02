import type { Metadata } from 'next';

import { LogsClient } from './LogsClient';

export const metadata: Metadata = { title: 'Z-Admin — Технические логи' };

export default function AdminLogsPage() {
  return <LogsClient />;
}
