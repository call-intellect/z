import type { Metadata } from 'next';
import { OnboardingChangePasswordForm } from './OnboardingChangePasswordForm';

export const metadata: Metadata = {
  title: 'Смена пароля — Кора',
};

export default function OnboardingChangePasswordPage() {
  return <OnboardingChangePasswordForm />;
}
