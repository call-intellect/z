import type { Metadata } from 'next';

import { RoutingClient } from './RoutingClient';

export const metadata: Metadata = {
  title: 'Роутинг моделей — Z-Admin',
};

/**
 * Фаза 3 редизайна — `/admin/ai/routing`.
 *
 * Серверная обёртка вокруг клиентского `RoutingClient`. Сам клиент —
 * тонкая обёртка над `AiModelsClient` из старого `/admin/ai-models`,
 * с дополнительной шапкой `AdminSection` и хлебными крошками.
 *
 * Старый URL `/admin/ai-models` сохранён как redirect для обратной
 * совместимости (см. соответствующий `page.tsx`).
 */
export default function AdminAiRoutingPage() {
  return <RoutingClient />;
}
