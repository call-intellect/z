import type { Metadata } from 'next';

import { AuditClient } from './AuditClient';

export const metadata: Metadata = { title: 'Z-Admin — Журнал super_admin' };

export default function AdminAuditPage() {
  return <AuditClient />;
}
