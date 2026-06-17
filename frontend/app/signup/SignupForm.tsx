"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { AuthShell } from "@/ui/components/auth-shell/AuthShell";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

export function SignupForm() {
  const { register } = useAuth();
  const searchParams = useSearchParams();
  const refParam = searchParams?.get("ref") || "";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [consentDataProcessing, setConsentDataProcessing] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!consentDataProcessing) {
      toast.error("Подтвердите согласие с обработкой персональных данных.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await register(
        email.trim(),
        name.trim(),
        phone.trim() || undefined,
        companyName.trim() || undefined,
        honeypot,
        refParam,
        consentDataProcessing,
        consentMarketing,
      );
      setSubmittedEmail(email.trim());
      if (!result.emailSent) {
        toast.warning(
          "Запрос принят, но письмо не отправлено. Свяжитесь с поддержкой.",
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "email_disposable") {
          toast.error(
            "Этот почтовый сервис не поддерживается. Используйте основной email.",
          );
        } else {
          toast.error(humanizeApiError(err));
        }
      } else {
        toast.error("Не удалось отправить запрос. Попробуйте ещё раз.");
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
          Уже есть аккаунт?{" "}
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
          <Label htmlFor="signup-phone">Номер телефона (опционально)</Label>
          <Input
            id="signup-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+7 (999) 999-99-99"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-company">
            Название компании (опционально)
          </Label>
          <Input
            id="signup-company"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            autoComplete="organization"
            placeholder="Например: ООО Ромашка"
          />
        </div>

        {}
        {}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "-9999px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
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
          <input
            id="ref_field"
            name="ref_field"
            type="hidden"
            value={refParam}
            readOnly
          />
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="signup-consent-data"
              checked={consentDataProcessing}
              onCheckedChange={(v) => setConsentDataProcessing(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="signup-consent-data"
              className="text-xs font-normal leading-snug text-fg-secondary"
            >
              Согласен с{" "}
              <Link
                href="/terms"
                target="_blank"
                className="text-accent hover:underline"
              >
                обработкой персональных данных
              </Link>{" "}
              и{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="text-accent hover:underline"
              >
                политикой конфиденциальности
              </Link>
            </Label>
          </div>

          <div className="flex items-start gap-2.5">
            <Checkbox
              id="signup-consent-marketing"
              checked={consentMarketing}
              onCheckedChange={(v) => setConsentMarketing(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="signup-consent-marketing"
              className="text-xs font-normal leading-snug text-fg-secondary"
            >
              Согласен получать письма о новостях, обновлениях и специальных
              предложениях
            </Label>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting}
        >
          {submitting ? "Отправляем…" : "Получить пароль на почту"}
        </Button>
      </form>
    </AuthShell>
  );
}
