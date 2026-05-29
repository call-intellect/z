/**
 * Admin login устарел — теперь единый вход для всех на `/login`
 * (бэк `/api/v1/auth/login` сам определяет супер-админа и пускает в `/admin`).
 *
 * Эта страница оставлена как back-compat алиас: редиректит на `/login?next=/admin`,
 * чтобы старые закладки/ссылки продолжали работать. Форма `AdminLoginForm`
 * больше не используется (удалить в cleanup-фазе ТЗ unified-login).
 */
import { redirect } from 'next/navigation';

export default function AdminLoginPage() {
  redirect('/login?next=%2Fadmin');
}
