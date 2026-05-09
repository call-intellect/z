import type { Metadata } from 'next';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Регистрация — Z',
  description: 'Создайте аккаунт Z, чтобы получать AI-отчёты по своим встречам.',
};

export default function SignupPage() {
  return <SignupForm />;
}
