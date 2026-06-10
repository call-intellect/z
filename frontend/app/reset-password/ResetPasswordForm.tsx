'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { accountsApi } from '@/api/accounts.api';
import { ApiError } from '@/api/api-error';
import {
  PASSWORD_RULE_HINT,
  passwordsMatch,
  validatePassword,
} from '@/lib/password-validation';
import { AuthShell } from '@/ui/components/auth-shell/AuthShell';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

/**
 * Сброс пароля по token из письма.
 *
 * Поведение:
 *   - Если `?token=` нет — error-state, ссылка обратно на /forgot.
 *   - Валидация на клиенте (length, буква+цифра, совпадение).
 *   - На success — toast + push на `/login`.
 *   - На 410 (`reset_token_invalid`) — отдельный текст: токен недействителен.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? null;

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const passwordCheck = useMemo(() => validatePassword(password), [password]);
  const confirmOk = passwordsMatch(password, confirm);

  if (!token) {
    return (
      <AuthShell
        title="Ссылка недействительна"
        subtitle="В адресе нет токена сброса. Запросите новую ссылку."
        footer={
          <Link
            href="/forgot-password"
            className="text-accent underline-offset-4 hover:underline"
          >
            Запросить заново
          </Link>
        }
      >
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-fg-primary">
          Если вы перешли по ссылке из письма — попробуйте скопировать её
          целиком и вставить в адресную строку.
        </div>
      </AuthShell>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!passwordCheck.valid) {
      toast.error(passwordCheck.message ?? 'Пароль не подходит.');
      return;
    }
    if (!confirmOk) {
      toast.error('Пароли не совпадают.');
      return;
    }

    setSubmitting(true);
    try {
      await accountsApi.resetPassword({
        token: token!,
        newPassword: password,
      });
      toast.success('Пароль обновлён. Войдите с новым паролем.');
      router.replace('/login');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'reset_token_invalid') {
          toast.error('Ссылка недействительна или истекла. Запросите заново.');
        } else if (err.code === 'password_too_weak') {
          toast.error(`Пароль слишком простой. ${PASSWORD_RULE_HINT}`);
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Не удалось сбросить пароль. Попробуйте ещё раз.');
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Новый пароль"
      subtitle={PASSWORD_RULE_HINT}
      footer={
        <Link
          href="/login"
          className="text-accent underline-offset-4 hover:underline"
        >
          Вернуться ко входу
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="reset-password">Новый пароль</Label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            autoFocus
          />
          {password && !passwordCheck.valid ? (
            <p className="text-xs text-danger">{passwordCheck.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reset-confirm">Подтвердите пароль</Label>
          <Input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          {confirm && !confirmOk ? (
            <p className="text-xs text-danger">Пароли не совпадают.</p>
          ) : null}
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting || !passwordCheck.valid || !confirmOk}
        >
          {submitting ? 'Сохраняем…' : 'Установить пароль'}
        </Button>
      </form>
    </AuthShell>
  );
}
