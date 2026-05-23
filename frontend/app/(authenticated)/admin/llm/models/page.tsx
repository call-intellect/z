import type { Metadata } from 'next';

import { LlmModelsClient } from './LlmModelsClient';

export const metadata: Metadata = { title: 'Z-Admin — LLM модели' };

export default function LlmModelsPage() {
  return <LlmModelsClient />;
}
