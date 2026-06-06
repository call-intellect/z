import type { Metadata } from 'next';

import { BillingClient } from './BillingClient';

export const metadata: Metadata = {
  title: 'Тариф и лимиты — Кора',
};

export default function BillingPage() {
  return <BillingClient />;
}
