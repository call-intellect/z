"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";

import { usePendingActionsCount } from "@/hooks/usePendingActionsCount";

type Props = {
  orgId: string | null | undefined;
};

export function RequiresActionBanner({ orgId }: Props) {
  const router = useRouter();
  const { total, bySource } = usePendingActionsCount(orgId);

  if (total <= 0) {
    return null;
  }

  const isDanger = bySource.conflict > 0;
  const plural =
    total === 1
      ? "подтверждение"
      : total < 5
        ? "подтверждения"
        : "подтверждений";

  return (
    <button
      type="button"
      onClick={() => router.push("/actions")}
      aria-label={`Требует подтверждения: ${total}. Открыть центр действий.`}
      className={
        isDanger
          ? "group flex w-full items-center gap-3 rounded-lg border-l-4 border-chip-danger-fg/60 bg-chip-danger-bg/20 px-4 py-3 text-left transition-colors hover:bg-chip-danger-bg/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chip-danger-fg"
          : "group flex w-full items-center gap-3 rounded-lg border-l-4 border-chip-warning-fg/60 bg-chip-warning-bg/20 px-4 py-3 text-left transition-colors hover:bg-chip-warning-bg/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chip-warning-fg"
      }
    >
      <span
        className={
          isDanger
            ? "shrink-0 text-chip-danger-fg"
            : "shrink-0 text-chip-warning-fg"
        }
        aria-hidden="true"
      >
        {isDanger ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      </span>
      <span
        className={
          isDanger
            ? "flex-1 text-sm font-medium text-chip-danger-fg"
            : "flex-1 text-sm font-medium text-chip-warning-fg"
        }
      >
        Требует подтверждения: {total} {plural}
      </span>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-fg transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      >
        Открыть
        <ArrowRight size={14} />
      </span>
    </button>
  );
}
