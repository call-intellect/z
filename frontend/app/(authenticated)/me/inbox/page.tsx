import type { Metadata } from 'next';

import { InboxClient } from './InboxClient';

export const metadata: Metadata = {
  title: 'Инбокс — Z',
};

export default function MyInboxPage() {
  return <InboxClient />;
}
