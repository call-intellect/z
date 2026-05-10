import type { Metadata } from 'next';

import { LlmPricesClient } from './LlmPricesClient';

export const metadata: Metadata = { title: 'Z-Admin — Прайс LLM' };

export default function LlmPricesPage() {
  return <LlmPricesClient />;
}
