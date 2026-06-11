import type { Metadata } from 'next';

import { OrgDetailClient } from './OrgDetailClient';

export const metadata: Metadata = { title: 'Организация' };

/**
 * Server-обёртка глобальной карточки Org (Z-Admin Фаза 4 редизайна).
 *
 * 7 вкладок: Обзор / Тариф и лимиты / Участники / Источники / Экономика /
 * Аудит / Опасная зона. Активная вкладка — query-param `?tab=...`,
 * управляется через `<AdminTabs>` внутри `<OrgDetailClient>`.
 *
 * Доступ — super_admin only. Backend защищает API (403); фронт показывает
 * `<AdminForbidden>` в Tab-контенте при необходимости.
 */
export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrgDetailClient orgId={id} />;
}
