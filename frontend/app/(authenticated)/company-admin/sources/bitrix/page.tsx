import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { BitrixIntegrationClient } from '../../../settings/integrations/BitrixIntegrationClient';

export const metadata: Metadata = {
  title: 'Источник: Bitrix24',
};

/**
 * Управление источником «Bitrix24» в составе «Админка компании → Источники»
 * (ТЗ 2026-06-16: интеграция = источник). Переиспользует готовый
 * `BitrixIntegrationClient` (подключение портала / установка из Маркета,
 * проверка соединения, отключение).
 */
export default function CompanyAdminBitrixSourcePage() {
  return (
    <div>
      <Link
        href="/company-admin/sources"
        className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={15} /> К источникам
      </Link>
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <BitrixIntegrationClient />
      </div>
    </div>
  );
}
