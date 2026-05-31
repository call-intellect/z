import type { Metadata } from 'next';

import { PromptExperimentNewClient } from './PromptExperimentNewClient';

export const metadata: Metadata = {
  title: 'Новый эксперимент — Управление',
};

export default function AdminPromptExperimentNewPage() {
  return <PromptExperimentNewClient />;
}
