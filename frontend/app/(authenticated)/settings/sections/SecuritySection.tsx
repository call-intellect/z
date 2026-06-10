'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { accountsApi } from '@/api/accounts.api';
import { ApiError } from '@/api/api-error';
import {
  PASSWORD_RULE_HINT,
  passwordsMatch,
  validatePassword,
} from '@/lib/password-validation';
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

export function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const passwordCheck = useMemo(
    () => validatePassword(newPassword),
    [newPassword],
  );
  const confirmOk = passwordsMatch(newPassword, confirm);

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
      await accountsApi.changePassword({ currentPassword, newPassword });
      toast.success('Пароль обновлён. Остальные сессии завершены.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'current_password_invalid') {
          toast.error('Текущий пароль введён неверно.');
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Не удалось сменить пароль. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Безопасность</CardTitle>
        <CardDescription>
          Смена пароля. После сохранения все остальные ваши сессии будут
          завершены — текущая останется активной.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="sec-current">Текущий пароль</Label>
            <Input
              id="sec-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sec-new">Новый пароль</Label>
            <Input
              id="sec-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            {newPassword && !passwordCheck.valid ? (
              <p className="text-xs text-danger">{passwordCheck.message}</p>
            ) : (
              <p className="text-xs text-fg-tertiary">{PASSWORD_RULE_HINT}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sec-confirm">Подтвердите пароль</Label>
            <Input
              id="sec-confirm"
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
            disabled={
              submitting ||
              !passwordCheck.valid ||
              !confirmOk ||
              currentPassword.length === 0
            }
          >
            {submitting ? 'Сохраняем…' : 'Сменить пароль'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
