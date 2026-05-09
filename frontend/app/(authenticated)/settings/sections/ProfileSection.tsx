'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { accountsApi } from '@/api/accounts.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

export function ProfileSection() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Подхватываем имя при apply изменений auth-context (refresh).
  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error('Имя не может быть пустым.');
      return;
    }
    setSubmitting(true);
    try {
      await accountsApi.updateMe({ name: trimmed });
      await refresh();
      toast.success('Профиль сохранён.');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error('Не удалось сохранить. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Профиль</CardTitle>
        <CardDescription>
          Имя видно вам и участникам встреч. Email менять нельзя — это ваш
          логин.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              type="email"
              value={user?.email ?? ''}
              disabled
              readOnly
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Имя</Label>
            <Input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <Button type="submit" disabled={submitting || name.trim() === (user?.name ?? '')}>
            {submitting ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
