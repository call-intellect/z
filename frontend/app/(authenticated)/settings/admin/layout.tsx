import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SettingsSidebar } from '../SettingsSidebar';

export const metadata: Metadata = {
  title: 'Админка организации',
};

/**
 * Layout группы `/settings/admin/*` (Org-Admin Фаза 7).
 *
 * Структурно идентичен `/settings/*` — общий SettingsSidebar + правая колонка
 * (туда подмешаны разделы «Админка»). Защита доступа реализована на уровне
 * страниц-клиентов через probe-вызов `apiClient` (если backend вернёт 403 —
 * показываем empty-state).
 *
 * Owner/admin Org гарантируется бэком: каждый endpoint /api/v1/org-admin/*
 * требует `OrgAdminGuard`.
 */
export default function SettingsAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 md:flex-row">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
