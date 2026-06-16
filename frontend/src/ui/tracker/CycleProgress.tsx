"use client";

import { Progress } from "@/ui/shadcn/progress";
import {
  cycleDateRangeLabel,
  readCycleProgress,
  type Cycle,
} from "@/domain/tracker";

export function CycleProgress({ cycle }: { cycle: Cycle }) {
  const progress = readCycleProgress(cycle.progressSnapshot);
  const pct = progress ? Math.round(progress.doneRate * 100) : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-fg-primary">
          {cycle.name}
        </span>
        <span className="shrink-0 text-[11px] text-fg-tertiary">
          {cycleDateRangeLabel(cycle)}
        </span>
      </div>
      {pct !== null && progress ? (
        <>
          <Progress value={pct} className="h-1.5" />
          <div className="flex justify-between text-[11px] text-fg-tertiary">
            <span>
              {progress.done} из {progress.total}
            </span>
            <span>{pct}%</span>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-fg-tertiary">
          Прогресс ещё не считался
        </div>
      )}
    </div>
  );
}
