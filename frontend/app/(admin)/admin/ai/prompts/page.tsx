import type { Metadata } from 'next';

import { PromptsAiClient } from './PromptsAiClient';

export const metadata: Metadata = {
  title: 'Промпты — Z-Admin',
};

/**
 * Фаза 3 редизайна — `/admin/ai/prompts`.
 *
 * Старый URL `/admin/prompts` редиректит сюда; глубокие страницы
 * (`/admin/prompts/[id]`, `/admin/prompts/new`, `/admin/prompts/experiments`)
 * остаются по старым адресам — ссылки внутри табов на них указывают.
 */
export default function AdminAiPromptsPage() {
  return <PromptsAiClient />;
}
