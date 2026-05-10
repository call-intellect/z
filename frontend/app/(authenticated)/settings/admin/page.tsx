import { redirect } from 'next/navigation';

export default function SettingsAdminIndexPage(): never {
  redirect('/settings/admin/usage');
}
