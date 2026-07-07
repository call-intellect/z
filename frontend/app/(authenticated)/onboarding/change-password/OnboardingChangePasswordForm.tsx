"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { accountsApi } from "@/api/accounts.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import {
  PASSWORD_RULE_HINT,
  passwordsMatch,
  validatePassword,
} from "@/lib/password-validation";
import { AuthShell } from "@/ui/components/auth-shell/AuthShell";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

export function OnboardingChangePasswordForm() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();

  const isNoEmailUser = user?.email?.endsWith("@kora.local") ?? false;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
      toast.error(passwordCheck.message ?? "Пароль не подходит.");
      return;
    }
    if (!confirmOk) {
      toast.error("Пароли не совпадают.");
      return;
    }

    setSubmitting(true);
    try {
      if (isNoEmailUser) {
        await accountsApi.setInitialPassword({ newPassword });
      } else {
        await accountsApi.changePassword({ currentPassword, newPassword });
      }
      await refresh();
      toast.success("Пароль установлен.");
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "current_password_invalid") {
          toast.error("Временный пароль введён неверно.");
        } else {
          toast.error(humanizeApiError(err));
        }
      } else {
        toast.error("Не удалось сохранить пароль. Попробуйте ещё раз.");
      }
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <AuthShell
      title="Установите постоянный пароль"
      subtitle={
        isNoEmailUser
          ? "Придумайте пароль для входа в кабинет."
          : user
            ? `Вы вошли как ${user.email}. Прежде чем продолжить, замените временный пароль на постоянный.`
            : "Замените временный пароль из письма на постоянный."
      }
      footer={
        <button
          type="button"
          onClick={handleLogout}
          className="text-fg-tertiary underline-offset-4 hover:text-fg-secondary hover:underline"
        >
          Выйти
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {!isNoEmailUser && (
          <div className="space-y-1.5">
            <Label htmlFor="onb-current">Временный пароль (из письма)</Label>
            <Input
              id="onb-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              autoFocus
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="onb-new">Новый пароль</Label>
          <Input
            id="onb-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            autoFocus={isNoEmailUser}
          />
          {newPassword && !passwordCheck.valid ? (
            <p className="text-xs text-danger">{passwordCheck.message}</p>
          ) : (
            <p className="text-xs text-fg-tertiary">{PASSWORD_RULE_HINT}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onb-confirm">Подтвердите пароль</Label>
          <Input
            id="onb-confirm"
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
          disabled={
            submitting ||
            !passwordCheck.valid ||
            !confirmOk ||
            (!isNoEmailUser && !currentPassword)
          }
        >
          {submitting ? "Сохраняем…" : "Сохранить и продолжить"}
        </Button>
      </form>
    </AuthShell>
  );
}
