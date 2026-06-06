import type { Metadata } from 'next';

import { WebhooksClient } from './WebhooksClient';

export const metadata: Metadata = {
  title: 'Webhooks — Кора',
};

export default function WebhooksPage() {
  return <WebhooksClient />;
}
