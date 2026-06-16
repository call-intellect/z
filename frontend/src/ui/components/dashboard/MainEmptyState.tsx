"use client";

import Link from "next/link";
import { ArrowRight, Building2, Sparkles } from "lucide-react";

export type MainEmptyStateProps = {
  canReturnToDemo?: boolean;
  onReturnToDemo?: () => void;
  setupProgress?: { completed: number; total: number };
};

export function MainEmptyState({
  canReturnToDemo = false,
  onReturnToDemo,
  setupProgress,
}: MainEmptyStateProps) {
  const showProgress =
    setupProgress != null &&
    setupProgress.total > 0 &&
    setupProgress.completed < setupProgress.total;
  const pct = showProgress
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round((setupProgress!.completed / setupProgress!.total) * 100),
        ),
      )
    : 0;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-border-default bg-bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-chip-info-bg text-chip-info-fg">
          <Building2 size={28} />
        </div>
        <h2 className="mb-3 text-2xl font-semibold text-fg-primary">
          Ваша компания пока пустая
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-fg-secondary">
          Демо «ТехноСтрим» показал, как работает Кора. Чтобы создавать встречи,
          задачи и регламенты в своей компании — оплатите подписку.
        </p>
        {showProgress ? (
          <div className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-4 text-left">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-accent">
              <Sparkles size={14} />
              Настройка компании · {setupProgress!.completed}/
              {setupProgress!.total}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay/60">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <Link
              href="/onboarding/company/step-1"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
            >
              Настроить компанию
              <ArrowRight size={12} />
            </Link>
          </div>
        ) : null}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/settings/subscription"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
          >
            Оплатить подписку
            <ArrowRight size={16} />
          </Link>
          {canReturnToDemo && onReturnToDemo ? (
            <button
              type="button"
              onClick={onReturnToDemo}
              className="inline-flex items-center justify-center rounded-md border border-border-default bg-bg-overlay/40 px-5 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-overlay/80 hover:text-fg-primary"
            >
              Вернуться в демо
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
