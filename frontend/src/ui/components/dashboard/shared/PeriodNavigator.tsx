"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  comparePeriods,
  currentPeriod,
  formatPeriodLabel,
  mondayOf,
  shiftPeriod,
  type ReportRhythm,
} from "@/domain/period";
import { CHART } from "@/ui/components/dashboard/modern";

type PeriodNavigatorStateHint = "ok" | "warn" | "risk" | null;

type PeriodNavigatorAvailable = {
  period: string;
  stateHint?: PeriodNavigatorStateHint;
  title?: string | null;
};

type PeriodNavigatorProps = {
  rhythm: ReportRhythm;
  value: string;
  latest: string;
  available?: PeriodNavigatorAvailable[];
  onChange: (period: string) => void;
};

function clampToLatest(picked: string, latest: string): string {
  return comparePeriods(picked, latest) > 0 ? latest : picked;
}

function hintColor(hint: PeriodNavigatorStateHint | undefined): string {
  switch (hint) {
    case "ok":
      return CHART.mint;
    case "warn":
      return CHART.amber;
    case "risk":
      return CHART.red;
    default:
      return CHART.faint;
  }
}

export function PeriodNavigator({
  rhythm,
  value,
  latest,
  available = [],
  onChange,
}: PeriodNavigatorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const forwardDisabled = comparePeriods(value, latest) >= 0;
  const label = formatPeriodLabel(rhythm, value || currentPeriod(rhythm));

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function openPicker() {
    const node = inputRef.current;
    if (!node) return;
    if (typeof node.showPicker === "function") {
      try {
        node.showPicker();
        return;
      } catch {
        node.focus();
        node.click();
        return;
      }
    }
    node.focus();
    node.click();
  }

  function handlePicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.value;
    if (!picked) return;
    if (rhythm === "week") {
      onChange(clampToLatest(mondayOf(picked), latest));
      return;
    }
    onChange(clampToLatest(picked, latest));
  }

  function selectFromArchive(period: string) {
    onChange(period);
    setOpen(false);
  }

  const inputType = rhythm === "month" ? "month" : "date";

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center gap-1 rounded-xl p-1"
      style={{
        background: "var(--surface-inset)",
        border: "1px solid var(--border-inset)",
      }}
    >
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(rhythm, value, -1))}
        aria-label="Предыдущий период"
        className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-inset-strong)]"
        style={{ color: CHART.dim }}
      >
        <ChevronLeft size={16} />
      </button>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Выбрать период"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="min-w-[140px] rounded-lg px-2 py-1 text-center text-xs font-medium transition-colors hover:bg-[var(--surface-inset-strong)]"
        style={{ color: CHART.text }}
      >
        {label}
      </button>

      <button
        type="button"
        onClick={() => onChange(shiftPeriod(rhythm, value, 1))}
        disabled={forwardDisabled}
        aria-label="Следующий период"
        className="grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-inset-strong)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        style={{ color: CHART.dim }}
      >
        <ChevronRight size={16} />
      </button>

      <input
        ref={inputRef}
        type={inputType}
        value={value}
        max={latest}
        onChange={handlePicked}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 h-px w-px opacity-0"
      />

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-2 flex w-[260px] flex-col overflow-hidden rounded-xl"
          style={{
            background: "var(--glass-surface)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow)",
          }}
        >
          <div className="px-3 pb-1 pt-3">
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: CHART.faint }}
            >
              Недавние отчёты
            </span>
          </div>

          <div className="flex max-h-[280px] flex-col overflow-auto px-1 pb-1">
            {available.length === 0 ? (
              <span
                className="px-2 py-3 text-xs"
                style={{ color: CHART.dim }}
              >
                Пока нет других отчётов
              </span>
            ) : (
              available.map((item) => {
                const isActive = comparePeriods(item.period, value) === 0;
                return (
                  <button
                    key={item.period}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => selectFromArchive(item.period)}
                    className="flex items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-inset-strong)]"
                    style={
                      isActive
                        ? { background: "var(--surface-inset-strong)" }
                        : undefined
                    }
                  >
                    <span
                      aria-hidden
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: hintColor(item.stateHint) }}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className="truncate text-xs font-medium"
                        style={{ color: CHART.text }}
                      >
                        {formatPeriodLabel(rhythm, item.period)}
                      </span>
                      {item.title ? (
                        <span
                          className="truncate text-[11px]"
                          style={{ color: CHART.dim }}
                        >
                          {item.title}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? (
                      <Check
                        size={14}
                        aria-hidden
                        className="ml-auto mt-0.5 shrink-0"
                        style={{ color: CHART.mint }}
                      />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div
            className="border-t px-1 py-1"
            style={{ borderColor: "var(--glass-border)" }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openPicker();
              }}
              className="w-full rounded-lg px-2 py-2 text-left text-xs font-medium transition-colors hover:bg-[var(--surface-inset-strong)]"
              style={{ color: CHART.dim }}
            >
              Выбрать дату…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
