"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { accountsApi } from "@/api/accounts.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { AuthShell } from "@/ui/components/auth-shell/AuthShell";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await accountsApi.forgotPassword({ email: email.trim() });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(humanizeApiError(err));
      } else {
        toast.error("Не удалось отправить запрос. Попробуйте ещё раз.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell
        title="Проверьте почту"
        subtitle="Если такой email зарегистрирован, мы отправили инструкции по сбросу пароля."
        footer={
          <Link
            href="/login"
            className="text-accent underline-offset-4 hover:underline"
          >
            Вернуться ко входу
          </Link>
        }
      >
        <div className="rounded-md border border-border-subtle bg-bg-overlay p-4 text-sm text-fg-secondary">
          Не нашли письмо? Проверьте папку «Спам» или повторите запрос через
          несколько минут.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Восстановление пароля"
      subtitle="Введите email — пришлём ссылку для сброса."
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
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? "Отправляем…" : "Отправить инструкции"}
        </Button>
      </form>
    </AuthShell>
  );
}
