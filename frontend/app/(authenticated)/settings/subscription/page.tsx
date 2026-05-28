import type { Metadata } from 'next';

import { SubscriptionClient } from './SubscriptionClient';

export const metadata: Metadata = {
  title: 'Подписка и оплата — Кора',
};

export default function SubscriptionPage() {
  return <SubscriptionClient />;
}
