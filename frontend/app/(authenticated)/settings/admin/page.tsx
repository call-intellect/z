import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/admin` — «Админка» переехала в `/company-admin`
 * (ТЗ 2026-06-02 — развод «Настройки»/«Админка компании»). Редирект ради
 * совместимости закладок.
 */
export default function SettingsAdminIndexPage(): never {
  redirect('/company-admin');
}
