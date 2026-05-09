import type { ReactNode } from 'react';
import { AuthenticatedShell } from './AuthenticatedShell';

/**
 * Layout группы `(authenticated)` — оборачивает все защищённые страницы
 * в общий AppShell (sidebar + header). Доступ контролируется
 * через `frontend/middleware.ts` (cookie z_session) + клиентский guard
 * `<AuthenticatedShell>` (см. ниже).
 *
 * Особенности:
 *   - Если `auth.user.mustChangePassword` — форсированный редирект на
 *     `/onboarding/change-password`. До смены пароля никаких других
 *     защищённых страниц юзер не видит.
 *   - На самой странице `/onboarding/change-password` AppShell не рендерится
 *     (sidebar заблокировать невозможно надёжно — проще убрать).
 */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
