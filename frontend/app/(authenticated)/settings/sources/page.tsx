import type { Metadata } from 'next';

import { SourcesClient } from './SourcesClient';

export const metadata: Metadata = {
  title: 'Источники — Z',
};

/**
 * Страница `/settings/sources` (Фаза 10 knowledge-core).
 *
 * Управление подключёнными адаптерами Org: Telegram-бот, Mango-телефония,
 * IMAP-почта, web-form ("дамп мысли"). Доступна owner/admin Org;
 * RBAC-проверка делается на бэке (`policy.csv` ресурс=source).
 */
export default function SettingsSourcesPage() {
  return <SourcesClient />;
}
