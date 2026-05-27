import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Регистрация — Кора',
  description: 'Создайте аккаунт Кора, чтобы получать AI-отчёты по своим встречам.',
};

export default function SignupPage() {
  // Suspense обязателен: Next 16 на prerender требует boundary вокруг
  // клиентских форм, использующих хуки `useSearchParams`/`useRouter`
  // (через `useAuth` и др. транзитивно). Без него build падает
  // `useSearchParams() should be wrapped in a suspense boundary`.
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
