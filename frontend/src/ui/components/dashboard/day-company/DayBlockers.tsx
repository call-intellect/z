"use client";

import { ArrowUpRight, Ban } from "lucide-react";

import type { OperationsBlockerApi } from "@/api/operations-dashboard.api";
import { CHART, CardTitle, glass } from "@/ui/components/dashboard/modern";
import { Chip } from "@/ui/components/dashboard/registry/_kit";

const RED_GRADIENT =
  "linear-gradient(135deg, oklch(0.72 0.2 25), oklch(0.58 0.22 20))";

function blockerLed(severity: OperationsBlockerApi["severity"]): string {
  if (severity === "high") return CHART.red;
  if (severity === "medium") return CHART.amber;
  return CHART.faint;
}

function daysSince(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 1;
  return Math.max(1, Math.floor((Date.now() - created) / 86400000));
}

export function DayBlockers({ items }: { items: OperationsBlockerApi[] }) {
  if (items.length === 0) return null;

  return (
    <div style={glass()} className="p-6">
      <div className="flex items-center gap-3">
        <CardTitle icon={<Ban size={17} />} grad={RED_GRADIENT}>
          Блокеры — что прямо мешает сейчас
        </CardTitle>
        <span className="ml-auto">
          <Chip tone="risk">{items.length} активных</Chip>
        </span>
      </div>

      <div className="mt-4 flex flex-col">
        {items.map((it) => {
          const led = blockerLed(it.severity);
          const days = daysSince(it.createdAt);
          const owner = it.ownerPersonName ?? "—";
          const meta = it.ownerHint
            ? `владелец: ${owner} · ${it.ownerHint}`
            : `владелец: ${owner}`;
          return (
            <div
              key={it.id}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: led, boxShadow: `0 0 8px ${led}` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[13.5px] font-medium"
                  style={{ color: CHART.text }}
                >
                  {it.text}
                </span>
                <span
                  className="mt-0.5 block truncate text-[11.5px]"
                  style={{ color: CHART.faint }}
                >
                  {meta}
                </span>
              </span>
              <Chip tone={days > 5 ? "risk" : "warn"}>{days}-й день</Chip>
              <ArrowUpRight
                size={16}
                className="shrink-0"
                style={{ color: CHART.faint, opacity: 0.6 }}
                aria-hidden
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
