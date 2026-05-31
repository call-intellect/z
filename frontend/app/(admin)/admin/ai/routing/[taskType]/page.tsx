import type { Metadata } from 'next';

import { RoutingDetailClient } from './RoutingDetailClient';

export const metadata: Metadata = {
  title: 'Модель агента — Z-Admin',
};

/**
 * Фаза 3 редизайна — детальная карточка `/admin/ai/routing/[taskType]`.
 *
 * Server-обёртка. Раскладывает существующий TaskTypeDetailsClient на 4
 * вкладки (Цепочка / Метрики / История / A/B) через AdminTabs.
 */
export default function AdminAiRoutingDetailPage({
  params,
}: {
  params: { taskType: string };
}) {
  return (
    <RoutingDetailClient taskType={decodeURIComponent(params.taskType)} />
  );
}
