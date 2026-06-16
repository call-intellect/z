"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";

import type { OrgInvitationCreateResultDomain } from "@/domain/org-invitations";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

type Props = {
  open: boolean;
  result: OrgInvitationCreateResultDomain | null;
  onOpenChange: (open: boolean) => void;
};

export function InviteCreatedDialog({ open, result, onOpenChange }: Props) {
  if (!result) {
    return null;
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Скопируйте ссылку для сотрудника</DialogTitle>
          <DialogDescription>
            {result.email
              ? `Письмо отправлено на ${result.email}. Если сотрудник не получит — отправьте ссылку вручную.`
              : "Отправьте ссылку сотруднику в любой мессенджер. По ссылке он войдёт без пароля и подключит Telegram-бота."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <CopyableField
            label="Ссылка для сотрудника"
            value={result.manualShareUrl}
            successMessage="Ссылка скопирована"
          />

          <QrPreview
            value={result.manualShareUrl}
            qrDataUrl={result.qrCodeDataUrl}
          />

          <CopyableField
            label="Прямая ссылка на Telegram-бота"
            value={result.telegramDeepLink}
            successMessage="Ссылка на бота скопирована"
            icon={<Send className="h-3.5 w-3.5" />}
          />

          <CopyableField
            label="Код для бота (на случай ручного ввода)"
            value={result.linkCode}
            successMessage="Код скопирован"
            monospace
          />

          <p className="text-xs text-fg-secondary">
            Ссылка действует до{" "}
            <strong>
              {result.expiresAt.toLocaleString("ru-RU", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
            . Если сотрудник не успеет — перевыпустите приглашение.
          </p>

          <p className="text-xs text-fg-secondary">
            Telegram-бот — личный помощник сотрудника: через него Кора присылает
            чек-ины, напоминания и собирает короткие апдейты. Подключение по
            желанию.
          </p>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CopyableFieldProps = {
  label: string;
  value: string;
  successMessage: string;
  icon?: React.ReactNode;
  monospace?: boolean;
};

function CopyableField({
  label,
  value,
  successMessage,
  icon,
  monospace,
}: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(successMessage);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className={monospace ? "font-mono text-sm" : ""}
          onFocus={(e) => e.target.select()}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Готово
            </>
          ) : (
            <>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Скопировать
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

type QrPreviewProps = {
  value: string;
  qrDataUrl: string | null;
};

function QrPreview({ value, qrDataUrl }: QrPreviewProps) {
  const externalQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    value,
  )}`;
  const src = qrDataUrl ?? externalQrUrl;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-subtle bg-bg-overlay p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- QR-картинка для копирования директором; не критична для SEO/перформанса. */}
      <img
        src={src}
        alt="QR-код приглашения"
        width={120}
        height={120}
        className="rounded-md border border-border-subtle bg-bg-card p-1"
      />
      <div className="space-y-1 text-xs text-fg-secondary">
        <p className="font-medium text-fg-primary">
          QR-код для быстрого открытия
        </p>
        <p>
          Покажите сотруднику — он отсканирует камерой и сразу войдёт в кабинет.
        </p>
        {qrDataUrl ? null : (
          <p className="text-fg-tertiary">
            QR сгенерирован внешним сервисом api.qrserver.com.
          </p>
        )}
      </div>
    </div>
  );
}
