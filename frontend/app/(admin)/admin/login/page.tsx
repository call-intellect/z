/**
 * Admin login — отдельная страница для входа администраторов через
 * `/api/v1/auth/admin-login`.
 *
 * Зачем отдельно от `/login` (который для обычных пользователей):
 *   - Чтобы публичная форма не палила существование admin-учёток.
 *   - Чтобы admin-login использовал уже существующий backend-endpoint
 *     (`adminApi.adminLogin`) и не зависел от accounts-flow.
 *
 * Эта страница ВЫНЕСЕНА из общей admin layout-обёртки специальным layout-ом
 * рядом, чтобы AdminRouteGuard её не пытался защитить.
 */

import { AdminLoginForm } from './AdminLoginForm';

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-16">
      <AdminLoginForm />
    </main>
  );
}
