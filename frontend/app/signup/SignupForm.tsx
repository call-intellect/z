'use client';

import Link from 'next/link';
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
 * Lead-style регистрация: имя + email → бэкенд шлёт временный пароль письмом.
 *
 * UX:
 *   - Honeypot-поле `hp_field` — невидимое, для отсева ботов. Если бот
 *     заполнит — backend silent OK без действий.
 *   - Чекбокс согласия с обработкой — обязательный (для PD compliance).
 *   - На success — заменяем форму на success-state (без редиректа: юзер
 *     не залогинен, ему нужно прочитать письмо и зайти).
 */
export function SignupForm() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!consent) {
      toast.error('Подтвердите согласие с обработкой данных.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(
        email.trim(),
        name.trim(),
        companyName.trim() || undefined,
        honeypot,
      );
      setSubmittedEmail(email.trim());
      if (!result.emailSent) {
        toast.warning(
          'Запрос принят, но письмо не отправлено. Свяжитесь с поддержкой.',
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'email_disposable') {
          toast.error(
            'Этот почтовый сервис не поддерживается. Используйте основной email.',
          );
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error('Не удалось отправить запрос. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedEmail) {
    return (
      <AuthShell
        title="Проверьте почту"
        subtitle={`На ${submittedEmail} отправлено письмо с временным паролем. Откройте его и войдите.`}
        footer={
          <Link
            href="/login"
            className="text-accent underline-offset-4 hover:underline"
          >
            Перейти ко входу
          </Link>
        }
      >
        <div className="rounded-md border border-accent-border bg-accent-muted p-4 text-sm text-fg-primary">
          <p className="mb-2 font-medium">Что дальше:</p>
          <ol className="list-decimal space-y-1 pl-5 text-fg-secondary">
            <li>Откройте письмо от noreply@crossmark.ru.</li>
            <li>Скопируйте временный пароль.</li>
            <li>Войдите и сразу смените пароль на постоянный.</li>
          </ol>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Создать аккаунт"
      subtitle="Оставьте имя и email — пришлём пароль на почту."
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link
            href="/login"
            className="text-accent underline-offset-4 hover:underline"
          >
            Войти
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="signup-name">Имя</Label>
          <Input
            id="signup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            autoFocus
            placeholder="Например: Алексей"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="you@company.ru"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-company">Название компании (опционально)</Label>
          <Input
            id="signup-company"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            autoComplete="organization"
            placeholder="Например: ООО Ромашка"
          />
        </div>

        {/* Honeypot — спрятан от пользователя, виден только ботам. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '-9999px',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
          }}
        >
          <label htmlFor="hp_field">Не заполняйте это поле</label>
          <input
            id="hp_field"
            name="hp_field"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox
            id="signup-consent"
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
            className="mt-0.5"
          />
          <Label
            htmlFor="signup-consent"
            className="text-xs font-normal leading-snug text-fg-secondary"
          >
            Согласен на обработку персональных данных и получение писем,
            связанных с использованием сервиса.
          </Label>
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? 'Отправляем…' : 'Получить пароль на почту'}
        </Button>
      </form>
    </AuthShell>
  );
}
