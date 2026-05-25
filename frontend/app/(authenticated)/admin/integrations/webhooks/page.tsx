import type { Metadata } from 'next';

import { WebhooksIntegrationsClient } from './WebhooksIntegrationsClient';

export const metadata: Metadata = {
  title: 'Z-Admin — Webhook subscriptions',
};

export default function AdminWebhooksIntegrationsPage() {
  return <WebhooksIntegrationsClient />;
}
