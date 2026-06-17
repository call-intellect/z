"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/shadcn/sheet";
import { apiClient } from "@/api/api-client";
import { cn } from "@/ui/shadcn/lib/utils";

export type AdminSettingHistoryEntry = {
  id?: string;
  changedAt: string;
  changedBy: string;
  prevValue: unknown;
  newValue: unknown;
  reason?: string | null;
};

type Props = {
  settingKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history?: AdminSettingHistoryEntry[];
};

export function AdminSettingHistoryDrawer({
  settingKey,
  open,
  onOpenChange,
  history: providedHistory,
}: Props) {
  const [history, setHistory] = useState<AdminSettingHistoryEntry[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !settingKey) return;
    if (providedHistory) {
      setHistory(providedHistory);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setHistory(null);

    const path = `/api/v1/admin/settings/${encodeURIComponent(settingKey)}/history`;
    apiClient
      .get<{ items: AdminSettingHistoryEntry[] }>(path)
      .then((res) => {
        if (cancelled) return;
        setHistory(res.items ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistory([]);
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить историю",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, settingKey, providedHistory]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History size={16} className="text-fg-tertiary" aria-hidden />
            История изменений
          </SheetTitle>
          {settingKey ? (
            <SheetDescription>
              Ключ:{" "}
              <span className="font-mono text-fg-secondary">{settingKey}</span>
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="-mx-2 flex-1 overflow-y-auto px-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-fg-tertiary">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Загружаю историю…
            </div>
          ) : null}

          {!loading && error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              {error}
            </p>
          ) : null}

          {!loading && history && history.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-tertiary">
              История изменений пуста.
            </p>
          ) : null}

          {!loading && history && history.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {history.map((entry, idx) => (
                <li
                  key={entry.id ?? `${entry.changedAt}-${idx}`}
                  className="rounded-md border border-border-subtle bg-bg-card p-3"
                >
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="text-fg-secondary">
                      {formatDateTime(entry.changedAt)}
                    </span>
                    <span className="font-mono text-fg-tertiary">
                      {entry.changedBy}
                    </span>
                  </div>
                  {entry.reason ? (
                    <p className="mb-2 text-xs text-fg-secondary">
                      <span className="text-fg-tertiary">Причина: </span>
                      {entry.reason}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <ValueBlock label="Было" value={entry.prevValue} mute />
                    <ValueBlock label="Стало" value={entry.newValue} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ValueBlock({
  label,
  value,
  mute,
}: {
  label: string;
  value: unknown;
  mute?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded border border-border-subtle p-2 font-mono",
        mute
          ? "bg-bg-overlay/40 text-fg-tertiary"
          : "bg-bg-overlay text-fg-secondary",
      )}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-tertiary">
        {label}
      </div>
      <pre className="whitespace-pre-wrap break-all text-[11px] leading-snug">
        {stringify(value)}
      </pre>
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
