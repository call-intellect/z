import type { Metadata } from 'next';

import { FeedbackTopicDetailClient } from './FeedbackTopicDetailClient';

export const metadata: Metadata = {
  title: 'Блок обратной связи',
};

/**
 * `/admin/feedback/[topicId]` — детальная страница смыслового блока:
 *   - title / description (read-only, Phase 8 добавит редактирование);
 *   - метрики itemsCount / uniqueUsersCount / percentOfWindow (переключатель окна);
 *   - список items с возможностью развернуть исходное сообщение.
 *
 * Защита: backend требует super_admin; frontend показывает `AdminForbidden` при 403.
 *
 * См. ТЗ: `plans/tz/2026-05-25-user-feedback-with-ai-clustering.md`,
 * раздел «Frontend — админский» → подраздел «Страница `/admin/feedback/[topicId]`».
 */
export default async function AdminFeedbackTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <FeedbackTopicDetailClient topicId={topicId} />;
}
