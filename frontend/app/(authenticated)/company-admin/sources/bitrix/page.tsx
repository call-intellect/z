import type { Metadata } from 'next';

import { BitrixIntegrationClient } from '../../../settings/integrations/BitrixIntegrationClient';

export const metadata: Metadata = {
  title: 'Источник: Bitrix24',
};

/**
 * Управление источником «Bitrix24» в составе «Админка компании → Источники»
 * (ТЗ 2026-06-17 bitrix24-source-sync). Переиспользует `BitrixIntegrationClient`
 * (подключение портала через OAuth, ручной синк IM+CRM, AI-анализ диалогов,
 * сопоставление сотрудников, отключение). Кнопка «К источникам» — внутри клиента.
 */
export default function CompanyAdminBitrixSourcePage() {
  return <BitrixIntegrationClient />;
}
