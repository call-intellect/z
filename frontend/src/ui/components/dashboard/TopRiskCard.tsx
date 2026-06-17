"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

type RiskItem = {
  id?: string;
  title?: string;
  subtitle?: string | null;
};

export type TopRiskCardProps = {
  risk: RiskItem | null;
  totalCount?: number;
  isReadOnlyDemo?: boolean;
  onPaywallTrigger?: () => void;
};

export function TopRiskCard({
  risk,
  totalCount = 0,
  isReadOnlyDemo = false,
  onPaywallTrigger,
}: TopRiskCardProps) {
  if (!risk) {
    return (
      <div className="flex h-full flex-col gap-2 rounded-2xl border border-chip-success-bg bg-chip-success-bg/30 p-4">
        <div className="flex items-center gap-2 text-chip-success-fg">
          <CheckCircle2 size={18} className="shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Самое острое
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-fg-primary">
          Нет критических рисков
        </p>
        <p className="text-xs text-fg-tertiary">
          Все темы под контролем — ничего срочного не висит.
        </p>
      </div>
    );
  }

  const extra = Math.max(0, totalCount - 1);

  return (
    <div className="flex h-full flex-col gap-2 rounded-2xl border border-chip-danger-bg bg-chip-danger-bg/20 p-4">
      <div className="flex items-center gap-2 text-chip-danger-fg">
        <AlertTriangle size={18} className="shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          Самое острое
        </span>
      </div>
      <p className="text-sm font-medium leading-snug text-fg-primary">
        {risk.title ?? "Критический риск"}
      </p>
      {risk.subtitle ? (
        <p className="text-xs text-fg-tertiary">{risk.subtitle}</p>
      ) : null}
      <div className="mt-auto flex items-center justify-between">
        {isReadOnlyDemo ? (
          <button
            type="button"
            onClick={onPaywallTrigger}
            title="Это демо. Оплатите чтобы создавать в своей компании."
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Открыть
            <ArrowRight size={12} />
          </button>
        ) : (
          <Link
            href="/insights"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
          >
            Открыть
            <ArrowRight size={12} />
          </Link>
        )}
        {extra > 0 ? (
          isReadOnlyDemo ? (
            <button
              type="button"
              onClick={onPaywallTrigger}
              title="Это демо. Оплатите чтобы создавать в своей компании."
              className="text-xs text-fg-tertiary hover:text-fg-secondary"
            >
              + ещё {extra} рисков
            </button>
          ) : (
            <Link
              href="/insights"
              className="text-xs text-fg-tertiary hover:text-fg-secondary"
            >
              + ещё {extra} рисков
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}
