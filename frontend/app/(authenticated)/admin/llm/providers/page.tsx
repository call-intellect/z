import type { Metadata } from 'next';

import { LlmProvidersClient } from './LlmProvidersClient';

export const metadata: Metadata = { title: 'Z-Admin — LLM провайдеры' };

export default function LlmProvidersPage() {
  return <LlmProvidersClient />;
}
