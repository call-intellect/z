import type { Metadata } from 'next';

import { HelpfulnessOverviewClient } from './HelpfulnessOverviewClient';

export const metadata: Metadata = {
  title: 'Помощь в команде',
};

/**
 * `/admin/helpfulness-overview` (Specialist 3.8) — служебная панель для HR /
 * руководителя / администратора организации.
 *
 * Содержит:
 *   - Карту помощников команды (taple по `team-map`).
 *   - Pending-spotlights с кнопками «Одобрить» / «Скрыть».
 *   - Приватные негативные сигналы (`unanswered`) — ТОЛЬКО здесь.
 *
 * Защита: бэк проверяет `helpfulness_trait:write` (owner/admin) и при 403
 * клиент показывает empty-state. Дополнительно клиентский guard скрывает
 * блок «приватные сигналы», если у пользователя нет роли owner/admin.
 */
export default function HelpfulnessOverviewPage() {
  return <HelpfulnessOverviewClient />;
}
