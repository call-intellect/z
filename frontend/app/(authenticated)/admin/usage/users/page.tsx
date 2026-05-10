import type { Metadata } from 'next';

import { UsersUsageClient } from './UsersUsageClient';

export const metadata: Metadata = { title: 'Z-Admin — Пользователи' };

export default function UsersUsagePage() {
  return <UsersUsageClient />;
}
