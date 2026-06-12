import type { Metadata } from 'next';

import { AdminReferralsClient } from './AdminReferralsClient';

export const metadata: Metadata = {
  title: 'Рефералы',
};

export default function AdminReferralsPage() {
  return <AdminReferralsClient />;
}
