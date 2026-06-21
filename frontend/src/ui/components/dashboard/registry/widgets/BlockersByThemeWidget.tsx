"use client";

import type { FC } from "react";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import useSWR from "swr";

import { operationsDashboardApi } from "@/api/operations-dashboard.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { ProvenanceDrawer } from "@/ui/components/provenance/ProvenanceDrawer";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { Chip } from "../_kit";

type ActiveTheme = { entityId: string; title: string };

export const BlockersByThemeWidget: FC<{ rhythm: Rhythm }> = () => {
  const { currentOrgId } = useAuth();
  const [active, setActive] = useState<ActiveTheme | null>(null);

  const swr = useSWR(
    currentOrgId ? ["blockers-by-theme", currentOrgId] : null,
    async () => operationsDashboardApi.getChronicBlockers({ limit: 10 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (swr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<ShieldAlert size={16} />} grad={GRAD.amber}>
          Что мешает — по темам
        </CardTitle>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      </GlassCard>
    );
  }

  const items = swr.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <GlassCard>
      <CardTitle icon={<ShieldAlert size={16} />} grad={GRAD.amber}>
        Что мешает — по темам
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Чему помочь сдвинуться — повторяющиеся помехи команды.
      </p>

      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const hasSource = item.relatedBlockIds.length > 0;
          const tone = item.status === "recurring" ? "risk" : "warn";
          const statusLabel =
            item.status === "recurring" ? "повторяется" : "новое";
          const inner = (
            <>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  style={{ color: CHART.text }}
                >
                  {item.representativeText}
                </span>
                <span
                  className="mt-0.5 block text-xs"
                  style={{ color: CHART.faint }}
                >
                  висит {item.daysOpen} дн.
                </span>
              </span>
              <Chip tone={tone}>{statusLabel}</Chip>
            </>
          );

          if (hasSource) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setActive({
                    entityId: item.relatedBlockIds[0]!,
                    title: item.representativeText,
                  })
                }
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:brightness-110"
                style={{ background: "var(--surface-inset)" }}
              >
                {inner}
              </button>
            );
          }

          return (
            <div
              key={item.id}
              className="flex w-full items-center gap-3 rounded-xl p-3"
              style={{ background: "var(--surface-inset)" }}
            >
              {inner}
            </div>
          );
        })}
      </div>

      <ProvenanceDrawer
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
        orgId={currentOrgId}
        entityType="block"
        entityId={active?.entityId ?? null}
        title={active?.title}
      />
    </GlassCard>
  );
};
