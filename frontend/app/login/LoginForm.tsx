'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { AuthShell } from '@/ui/components/auth-shell/AuthShell';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

/**
 * Публичный логин для обычных пользователей через `accounts/login`.
 * Админы логинятся отдельно через `/admin/login` (см.
 * `app/(admin)/admin/login/`) — сделано чтобы не палить существование
 * админ-учёток в публичной форме.
 *
 * После успеха:
 *   - Если есть `?next=` — push туда.
 *   - Иначе — push на `/meetings`.
 *   - Если `mustChangePassword=true` — guard в `(authenticated)/layout.tsx`
 *     сам отправит на `/onboarding/change-password`.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginStandalone } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const nextParam = searchParams?.get('next') ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await loginStandalone(email.trim(), password);
      // mustChangePassword обработает guard в (authenticated)/layout.
      const safeNext = isSafeNext(nextParam) ? nextParam! : '/meetings';
      router.replace(safeNext);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'login_invalid' || err.code === 'unauthorized') {
          toast.error('Неверный логин или пароль.');
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Не удалось войти. Попробуйте ещё раз.');
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Вход"
      subtitle="Войдите в свой кабинет Z."
      footer={
        <>
          Нет аккаунта?{' '}
          <Link
            href="/signup"
            className="text-accent underline-offset-4 hover:underline"
          >
            Создать аккаунт
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Пароль</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-fg-secondary underline-offset-4 hover:text-accent hover:underline"
            >
              Забыли пароль?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="login-remember"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          <Label
            htmlFor="login-remember"
            className="text-xs font-normal text-fg-secondary"
          >
            Запомнить меня
          </Label>
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? 'Входим…' : 'Войти'}
        </Button>
      </form>
    </AuthShell>
  );
}

/**
 * Безопасный next: только internal path (начинается с '/' но не с '//' и
 * не с '/http'). Защита от open-redirect.
 */
function isSafeNext(next: string | null): boolean {
  if (!next) return false;
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//')) return false;
  if (next.startsWith('/http')) return false;
  return true;
}
