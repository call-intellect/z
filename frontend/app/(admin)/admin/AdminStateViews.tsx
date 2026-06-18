"use client";

import { Loader2, ShieldAlert, AlertTriangle } from "lucide-react";

import { Button } from "@/ui/shadcn/button";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function AdminLoading({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function AdminLoadingInline({
  label = "Загружаем…",
}: {
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-tertiary">
      <Loader2 size={14} className="animate-spin" /> {label}
    </div>
  );
}

export function AdminForbidden({
  title = "Нет прав",
  description = "Этот раздел доступен только super_admin. Если уверены, что должны видеть — обратитесь к владельцу Z.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-subtle px-6 py-16 text-center">
      <ShieldAlert size={42} strokeWidth={1.5} className="mb-3 text-warning" />
      <h3 className="mb-2 text-lg font-medium">{title}</h3>
      <p className="max-w-md text-sm text-fg-tertiary">{description}</p>
    </div>
  );
}

export function AdminError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-danger/40 bg-danger/5 px-6 py-12 text-center">
      <AlertTriangle size={36} strokeWidth={1.5} className="mb-3 text-danger" />
      <h3 className="mb-1 text-lg font-medium">Что-то пошло не так</h3>
      <p className="mb-4 max-w-md text-sm text-fg-secondary">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function AdminEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-subtle px-6 py-16 text-center">
      <h3 className="mb-2 text-lg font-medium">{title}</h3>
      <p className="max-w-md text-sm text-fg-tertiary">{description}</p>
    </div>
  );
}
