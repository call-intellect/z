import type { Metadata } from 'next';

import { WebhooksIntegrationsClient } from './WebhooksIntegrationsClient';

export const metadata: Metadata = {
  title: 'Webhook subscriptions',
};

export default function AdminWebhooksIntegrationsPage() {
  return <WebhooksIntegrationsClient />;
}
