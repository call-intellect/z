import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { WizardShell } from './WizardShell';

export const metadata: Metadata = {
  title: 'Знакомство с компанией',
};

/**
 * Layout мастера «Знакомство с компанией» (`/onboarding/company/step-{1..5}`).
 *
 * AuthenticatedShell уже скрывает AppShell для всех `/onboarding/*`, так что
 * здесь рисуем только узкий каркас с progress-bar и кнопкой «Прервать».
 *
 * Гарды доступа (owner-only + `Department.count === 0`) — внутри
 * <WizardShell> через useEffect, чтобы можно было показать локальный
 * skeleton до выяснения роли пользователя.
 */
export default function OnboardingCompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <WizardShell>{children}</WizardShell>;
}
