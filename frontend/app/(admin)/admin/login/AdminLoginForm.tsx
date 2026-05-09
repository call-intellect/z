'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

/**
 * Форма admin-login. Использует backend `/api/v1/auth/admin-login`
 * (через `adminApi.adminLogin`) — отдельный flow от accounts/login.
 */
export function AdminLoginForm() {
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
        setErrorMessage('Неверный email или пароль.');
      } else {
        setErrorMessage('Что-то пошло не так.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border-subtle">
      <CardHeader>
        <CardTitle>Вход для администратора</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-password">Пароль</Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {errorMessage ? (
            <p className="text-sm text-danger" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Входим…' : 'Войти'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
