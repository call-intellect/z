"use client";

import { GlassCard } from "@/ui/components/dashboard/modern";

import type { Rhythm } from "./types";

const RHYTHM_LABEL: Record<Rhythm, string> = {
  today: "Сегодня",
  week: "Неделя",
  month: "Месяц",
};

export function DemoAlwaysWidget({ rhythm }: { rhythm: Rhythm }) {
  return (
    <GlassCard>
      <h3 className="text-[15px] font-semibold text-fg-primary">Демо-блок</h3>
      <p className="mt-1 text-sm text-fg-secondary">
        Ритм: {RHYTHM_LABEL[rhythm]}
      </p>
    </GlassCard>
  );
}

export function DemoConditionalWidget({
  rhythm,
  data,
}: {
  rhythm: Rhythm;
  data?: unknown;
}) {
  if (!data) return null;
  return (
    <GlassCard>
      <h3 className="text-[15px] font-semibold text-fg-primary">
        Демо-блок (условный)
      </h3>
      <p className="mt-1 text-sm text-fg-secondary">
        Ритм: {RHYTHM_LABEL[rhythm]}
      </p>
    </GlassCard>
  );
}
