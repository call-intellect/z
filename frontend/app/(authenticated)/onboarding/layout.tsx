import type { ReactNode } from 'react';

/**
 * Layout группы `(authenticated)/onboarding/*` — пере-определяет родительский,
 * но НЕ оборачивает в AppShell (это делает `AuthenticatedShell` через
 * проверку `pathname.startsWith('/onboarding')`).
 *
 * Здесь — просто passthrough, чтобы дочерние страницы могли рисовать свой
 * минимальный лэйаут без sidebar.
 */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
