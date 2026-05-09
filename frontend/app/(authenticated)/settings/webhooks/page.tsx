import type { Metadata } from 'next';

import { WebhooksClient } from './WebhooksClient';

export const metadata: Metadata = {
  title: 'Webhooks — Z',
};

export default function WebhooksPage() {
  return <WebhooksClient />;
}
