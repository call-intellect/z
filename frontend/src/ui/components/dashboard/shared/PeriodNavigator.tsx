"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import {
  comparePeriods,
  currentPeriod,
  formatPeriodLabel,
  mondayOf,
  shiftPeriod,
  type ReportRhythm,
} from "@/domain/period";
import { CHART } from "@/ui/components/dashboard/modern";

type PeriodNavigatorAvailable = {
  period: string;
  stateHint?: "ok" | "warn" | "risk" | null;
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

export function PeriodNavigator({
  rhythm,
  value,
  latest,
  onChange,
}: PeriodNavigatorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const forwardDisabled = comparePeriods(value, latest) >= 0;
  const label = formatPeriodLabel(rhythm, value || currentPeriod(rhythm));

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

  const inputType = rhythm === "month" ? "month" : "date";

  return (
    <div
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
        onClick={openPicker}
        aria-label="Выбрать период"
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
    </div>
  );
}
