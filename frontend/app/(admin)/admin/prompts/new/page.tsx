import type { Metadata } from 'next';

import { PromptCreateClient } from './PromptCreateClient';

export const metadata: Metadata = {
  title: 'Новый шаблон — Управление',
};

export default function AdminPromptCreatePage() {
  return <PromptCreateClient />;
}
