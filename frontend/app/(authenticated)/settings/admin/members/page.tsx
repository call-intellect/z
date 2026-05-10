import { redirect } from 'next/navigation';

/**
 * Org-Admin → Members. Раздел уже реализован как `/settings/organization`
 * (Фаза 0). Не дублируем — просто redirect.
 */
export default function SettingsAdminMembersPage(): never {
  redirect('/settings/organization');
}
