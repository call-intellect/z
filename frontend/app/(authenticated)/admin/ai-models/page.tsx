import type { Metadata } from 'next';

import { AiModelsClient } from './AiModelsClient';

export const metadata: Metadata = {
  title: 'AI Models — Admin',
};

export default function AdminAiModelsPage() {
  return <AiModelsClient />;
}
