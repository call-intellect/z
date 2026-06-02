import { redirect } from 'next/navigation';

/**
 * Старый путь `/settings/admin/usage` («Экономика организации») удалён —
 * расходы/себестоимость владельцу Org больше не показываем (ТЗ 2026-06-02).
 * Редиректим на «Админку компании» ради совместимости старых закладок.
 */
export default function OrgUsageRedirectPage(): never {
  redirect('/company-admin');
}
