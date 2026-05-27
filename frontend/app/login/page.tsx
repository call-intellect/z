import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Вход — Кора',
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
