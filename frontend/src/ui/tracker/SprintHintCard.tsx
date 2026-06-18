"use client";

import { useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import {
  getSprintHintKindLabel,
  getSprintHintSeverityLabel,
  type SprintHintApi,
  type SprintHintSeverityApi,
} from "@/domain/sprint";
import { cn } from "@/ui/shadcn/lib/utils";

const SEVERITY_STYLES: Record<
  SprintHintSeverityApi,
  { stripe: string; badge: string; iconClass: string }
> = {
  info: {
    stripe: "bg-slate-200",
    badge: "bg-slate-200 text-slate-900",
    iconClass: "text-slate-500",
  },
  warning: {
    stripe: "bg-amber-500",
    badge: "bg-amber-500 text-white",
    iconClass: "text-amber-500",
  },
  critical: {
    stripe: "bg-rose-500",
    badge: "bg-rose-500 text-white",
    iconClass: "text-rose-500",
  },
};

const SEVERITY_ICON: Record<SprintHintSeverityApi, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

export function SprintHintCard({
  hint,
  onDismiss,
  onResolve,
}: {
  hint: SprintHintApi;
  onDismiss?: (hintId: string) => Promise<void> | void;
  onResolve?: (hintId: string) => Promise<void> | void;
}) {
  const [pendingAction, setPendingAction] = useState<
    "dismiss" | "resolve" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const style = SEVERITY_STYLES[hint.severity] ?? SEVERITY_STYLES.info;
  const Icon = SEVERITY_ICON[hint.severity] ?? Info;

  const handle = async (
    action: "dismiss" | "resolve",
    cb?: (id: string) => Promise<void> | void,
  ) => {
    if (!cb) return;
    setPendingAction(action);
    setError(null);
    try {
      await cb(hint.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось выполнить действие. Попробуйте ещё раз.",
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <article
      className="relative flex gap-3 overflow-hidden rounded-md border border-border-subtle bg-bg-elevated p-4"
      aria-label={`Подсказка: ${hint.title}`}
    >
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 h-full w-1", style.stripe)}
      />
      <div className="ml-2 mt-0.5 shrink-0">
        <Icon size={18} strokeWidth={1.75} className={style.iconClass} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              style.badge,
            )}
            title={`Уровень: ${getSprintHintSeverityLabel(hint.severity)}`}
          >
            {getSprintHintSeverityLabel(hint.severity)}
          </span>
          <span className="text-[11px] text-fg-tertiary">
            {getSprintHintKindLabel(hint.kind)}
          </span>
          {hint.affectedIssueIds.length > 0 && (
            <span className="text-[11px] text-fg-tertiary">
              · {hint.affectedIssueIds.length}{" "}
              {pluralizeTasks(hint.affectedIssueIds.length)}
            </span>
          )}
        </div>

        <h3 className="text-sm font-semibold text-fg-primary">{hint.title}</h3>
        {hint.body && (
          <p className="whitespace-pre-wrap text-sm text-fg-secondary">
            {hint.body}
          </p>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {(onDismiss || onResolve) && (
          <div className="mt-1 flex flex-wrap gap-2">
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => void handle("dismiss", onDismiss)}
              >
                {pendingAction === "dismiss"
                  ? "Закрываем…"
                  : "Закрыть подсказку"}
              </Button>
            )}
            {onResolve && (
              <Button
                variant="outline"
                size="sm"
                disabled={pendingAction !== null}
                onClick={() => void handle("resolve", onResolve)}
              >
                {pendingAction === "resolve"
                  ? "Сохраняем…"
                  : "Принято к работе"}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function pluralizeTasks(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "задач";
  const last = n % 10;
  if (last === 1) return "задача";
  if (last >= 2 && last <= 4) return "задачи";
  return "задач";
}
