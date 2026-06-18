"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { AuthShell } from "@/ui/components/auth-shell/AuthShell";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const nextParam = searchParams?.get("next") ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const { isSuperAdmin } = await login(email.trim(), password);
      const target = isSafeNext(nextParam)
        ? nextParam!
        : isSuperAdmin
          ? "/admin"
          : "/meetings";
      router.replace(target);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "login_invalid" || err.code === "unauthorized") {
          toast.error("Неверный логин или пароль.");
        } else {
          toast.error(humanizeApiError(err));
        }
      } else {
        toast.error("Не удалось войти. Попробуйте ещё раз.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Вход"
      subtitle="Войдите в свой кабинет Кора."
      footer={
        <>
          Нет аккаунта?{" "}
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
          {submitting ? "Входим…" : "Войти"}
        </Button>
      </form>
    </AuthShell>
  );
}

function isSafeNext(next: string | null): boolean {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/http")) return false;
  return true;
}
