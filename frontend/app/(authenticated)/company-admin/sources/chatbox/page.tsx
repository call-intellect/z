import type { Metadata } from 'next';

import { ChatboxIntegrationClient } from '../../../chats/integrations/chatbox/ChatboxIntegrationClient';

export const metadata: Metadata = {
  title: 'Источник: Чат бокс',
};

/**
 * Управление источником «Чат бокс» в составе «Админка компании → Источники»
 * (ТЗ 2026-06-16: интеграция = источник). Переиспользует готовый
 * `ChatboxIntegrationClient` (подключение токена, синхронизация клиентов/
 * менеджеров, AI-анализ, отключение). Кнопка «К источникам» — внутри клиента.
 */
export default function CompanyAdminChatboxSourcePage() {
  return <ChatboxIntegrationClient />;
}
