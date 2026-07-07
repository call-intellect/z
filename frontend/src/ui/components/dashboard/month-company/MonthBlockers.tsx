"use client";

import { useState } from "react";
import { ArrowUpRight, Ban } from "lucide-react";

import type { OperationsBlockerApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import { CHART, CardTitle, glass } from "@/ui/components/dashboard/modern";
import { Chip } from "@/ui/components/dashboard/registry/_kit";
import { ProvenanceDrawer } from "@/ui/components/provenance/ProvenanceDrawer";

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

function dedupeByText(items: OperationsBlockerApi[]): OperationsBlockerApi[] {
  const byText = new Map<string, OperationsBlockerApi>();
  for (const it of items) {
    const key = it.text.trim().toLowerCase();
    const prev = byText.get(key);
    if (!prev || new Date(it.createdAt).getTime() < new Date(prev.createdAt).getTime()) {
      byText.set(key, it);
    }
  }
  return Array.from(byText.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function MonthBlockers({ items }: { items: OperationsBlockerApi[] }) {
  const unique = dedupeByText(items);
  const { currentOrgId } = useAuth();
  const [activeBlock, setActiveBlock] = useState<{ id: string; title: string } | null>(null);
  if (unique.length === 0) return null;

  return (
    <div style={glass()} className="p-6">
      <div className="flex items-center gap-3">
        <CardTitle icon={<Ban size={17} />} grad={RED_GRADIENT}>
          Блокеры месяца — что мешало весь месяц
        </CardTitle>
        <span className="ml-auto">
          <Chip tone="risk">{unique.length} активных</Chip>
        </span>
      </div>

      <div className="mt-4 flex flex-col">
        {unique.map((it) => {
          const led = blockerLed(it.severity);
          const days = daysSince(it.createdAt);
          const owner = it.ownerPersonName ?? "—";
          const meta = it.ownerHint
            ? `владелец: ${owner} · ${it.ownerHint}`
            : `владелец: ${owner}`;
          const clickable = Boolean(it.sourceBlockId);
          const inner = (
            <>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: led, boxShadow: `0 0 8px ${led}` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium" style={{ color: CHART.text }}>
                  {it.text}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: CHART.faint }}>
                  {meta}
                </span>
              </span>
              <Chip tone={days > 5 ? "risk" : "warn"}>{days}-й день</Chip>
              {clickable ? (
                <ArrowUpRight size={16} className="shrink-0" style={{ color: CHART.faint, opacity: 0.6 }} aria-hidden />
              ) : null}
            </>
          );
          return clickable ? (
            <button
              key={it.id}
              type="button"
              onClick={() => setActiveBlock({ id: it.sourceBlockId as string, title: it.text })}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
            >
              {inner}
            </button>
          ) : (
            <div key={it.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
              {inner}
            </div>
          );
        })}
      </div>

      <ProvenanceDrawer
        open={Boolean(activeBlock)}
        onOpenChange={(o) => {
          if (!o) setActiveBlock(null);
        }}
        orgId={currentOrgId}
        entityType="block"
        entityId={activeBlock?.id ?? null}
        title={activeBlock?.title}
      />
    </div>
  );
}
