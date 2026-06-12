import type { Metadata } from 'next';

import { EmbeddingsSettingsClient } from './EmbeddingsSettingsClient';

export const metadata: Metadata = {
  title: 'Эмбеддинги',
};

/**
 * Фаза 3 редизайна — `/admin/ai/embeddings`.
 *
 * Настройки эмбеддинг-провайдера, chunking и batch. Реиндексация —
 * placeholder под Фазу 8.
 */
export default function AdminAiEmbeddingsPage() {
  return <EmbeddingsSettingsClient />;
}
