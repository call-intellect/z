import type { Metadata } from 'next';

import { CatalogClient } from './CatalogClient';

export const metadata: Metadata = {
  title: 'Каталог LLM',
};

/**
 * Фаза 3 редизайна — объединённый каталог провайдеров, моделей, цен и
 * smoke-тестов. Старые страницы `/admin/llm-prices`, `/admin/llm/providers`,
 * `/admin/llm/models` помечены как redirect на `?tab=...` этого URL.
 */
export default function AdminAiCatalogPage() {
  return <CatalogClient />;
}
