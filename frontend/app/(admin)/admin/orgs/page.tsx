import type { Metadata } from 'next';

import { OrgsClient } from './OrgsClient';

export const metadata: Metadata = { title: 'Организации' };

export default function OrgsPage() {
  return <OrgsClient />;
}
