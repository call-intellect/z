import type { Metadata } from 'next';

import { CopyStringsClient } from './CopyStringsClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Глоссарий и UI-строки',
};

export default function AdminCopyStringsPage() {
  return <CopyStringsClient />;
}
