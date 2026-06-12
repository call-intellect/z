import type { Metadata } from 'next';

import { AuditClient } from './AuditClient';

export const metadata: Metadata = { title: 'Журнал super_admin' };

export default function AdminAuditPage() {
  return <AuditClient />;
}
