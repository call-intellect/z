import type { Metadata } from 'next';

import { PromptExperimentsListClient } from './PromptExperimentsListClient';

export const metadata: Metadata = {
  title: 'A/B-эксперименты по промптам — Управление',
};

export default function AdminPromptExperimentsPage() {
  return <PromptExperimentsListClient />;
}
