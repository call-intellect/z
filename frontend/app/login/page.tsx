'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await adminApi.adminLogin(email.trim(), password);
      await refresh();
      router.replace('/admin');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(t('login.failed'));
      } else {
        setErrorMessage(t('errors.unknown'));
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-stretch justify-center px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">
        {t('login.title')}
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">{t('login.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            className="rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="rounded-md border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        {errorMessage ? (
          <p className="text-sm text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <Button type="submit" loading={submitting}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>
    </main>
  );
}
