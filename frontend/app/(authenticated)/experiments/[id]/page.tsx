import type { Metadata } from 'next';

import { ExperimentDetailClient } from './ExperimentDetailClient';

export const metadata: Metadata = {
  title: 'Эксперимент',
};

/**
 * `/experiments/[id]` — детальная страница эксперимента (SBA β-6).
 *
 * Отдельный path для ссылок из chat-v2 / probe-events / уведомлений.
 * Контент почти повторяет правую панель master-detail, но в полноэкранном виде.
 */
export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExperimentDetailClient id={id} />;
}
