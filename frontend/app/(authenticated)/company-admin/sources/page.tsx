import type { Metadata } from 'next';

import { SourcesClient } from './SourcesClient';

export const metadata: Metadata = {
  title: 'Источники — Кора',
};

/**
 * Страница `/company-admin/sources` (ТЗ 2026-06-02 — развод «Настройки»/«Админка»).
 *
 * Управление подключёнными адаптерами Org: Telegram-бот, Mango-телефония,
 * IMAP-почта, web-form ("дамп мысли"). Доступна owner/admin Org;
 * RBAC-проверка делается на бэке (`policy.csv` ресурс=source).
 */
export default function CompanyAdminSourcesPage() {
  return <SourcesClient />;
}
