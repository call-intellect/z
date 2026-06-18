'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { accountsApi } from '@/api/accounts.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
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
import { WorkProfileSection } from '@/ui/settings/WorkProfileSection';
import { useTourContextOptional } from '@/ui/tour';

export function ProfileSection() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [submitting, setSubmitting] = useState(false);
  // TourProvider оборачивает все защищённые страницы (AuthenticatedShell),
  // поэтому контекст здесь обычно есть. Optional — на случай рендера
  // компонента вне провайдера (тесты, design-preview).
  const tour = useTourContextOptional();
  const [restartingTour, setRestartingTour] = useState(false);

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
        toast.error(humanizeApiError(err));
      } else {
        toast.error('Не удалось сохранить. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestartTour() {
    if (!tour || restartingTour) return;
    setRestartingTour(true);
    try {
      await tour.resetAll();
      tour.forceStart('welcome');
      toast.success('Знакомство снова покажется при возврате на главную.');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Не удалось сбросить прогресс знакомства.';
      toast.error(msg);
    } finally {
      setRestartingTour(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
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

      <WorkProfileSection />

      {tour && (
        <Card>
          <CardHeader>
            <CardTitle>Знакомство с Корой</CardTitle>
            <CardDescription>
              Покажет основные разделы. Можно запустить заново, если уже
              пропустили или хотите вспомнить.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleRestartTour}
              disabled={restartingTour}
            >
              {restartingTour ? 'Запускаем…' : 'Показать знакомство снова'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
