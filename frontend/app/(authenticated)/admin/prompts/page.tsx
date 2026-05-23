import type { Metadata } from 'next';

import { PromptsListClient } from './PromptsListClient';

export const metadata: Metadata = {
  title: 'Шаблоны промптов — Управление',
};

export default function AdminPromptsPage() {
  return <PromptsListClient />;
}
