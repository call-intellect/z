import type { Metadata } from 'next';

import { FeedbackDashboardClient } from './FeedbackDashboardClient';

export const metadata: Metadata = {
  title: 'Обратная связь пользователей — Z-Admin',
};

/**
 * `/admin/feedback` — дашборд обратной связи пользователей (super-admin only).
 *
 * Показывает смысловые блоки, в которые AI-кластеризатор группирует тезисы из
 * сообщений канала «Ваши предложения». Дрилл-даун открывает страницу деталей
 * блока со списком исходных items.
 *
 * Защита роли: backend возвращает 403 для не-super_admin. Frontend ловит это
 * как `ApiError.code === 'forbidden'` и показывает `AdminForbidden`.
 *
 * См. ТЗ: `plans/tz/2026-05-25-user-feedback-with-ai-clustering.md`,
 * раздел «Frontend — админский».
 */
export default function AdminFeedbackPage() {
  return <FeedbackDashboardClient />;
}
