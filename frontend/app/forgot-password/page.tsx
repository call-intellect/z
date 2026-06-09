import type { Metadata } from 'next';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Восстановление пароля',
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
