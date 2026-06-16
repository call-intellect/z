"use client";

import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { useEntitlement } from "@/hooks/useEntitlement";
import {
  FEATURE_MIN_TIER,
  featureLabel,
  tierLabel,
  type FeatureKey,
} from "@/domain/entitlement";
import { Button } from "@/ui/shadcn/button";
import { Card } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

export type TierGateProps = {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
};

export function TierGate({ feature, children, fallback }: TierGateProps) {
  const { enabled, tier, loading } = useEntitlement(feature);

  if (loading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (enabled) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return <DefaultTierFallback feature={feature} currentTier={tier} />;
}

export function DefaultTierFallback({
  feature,
  currentTier,
}: {
  feature: FeatureKey;
  currentTier: ReturnType<typeof useEntitlement>["tier"];
}) {
  const requiredTier = FEATURE_MIN_TIER[feature] ?? "tier_pro";
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <Card className="flex flex-col items-center px-6 py-12 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-muted text-accent">
          <Lock size={26} strokeWidth={1.5} />
        </div>
        <h2 className="mb-2 text-xl font-semibold">
          Доступно на тарифе {tierLabel(requiredTier)}
        </h2>
        <p className="mb-6 max-w-md text-sm text-fg-secondary">
          Функция «{featureLabel(feature)}» недоступна на вашем текущем тарифе (
          {tierLabel(currentTier)}). Обновитесь, чтобы открыть её.
        </p>
        <Button asChild size="default">
          <Link href="/settings/billing" className="gap-2">
            <Sparkles size={14} />
            Подробнее о тарифах
          </Link>
        </Button>
      </Card>
    </div>
  );
}

export function InlineTierFallback({
  feature,
  currentTier,
}: {
  feature: FeatureKey;
  currentTier: ReturnType<typeof useEntitlement>["tier"];
}) {
  const requiredTier = FEATURE_MIN_TIER[feature] ?? "tier_pro";
  return (
    <Card className="flex items-center gap-4 px-4 py-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
        <Lock size={16} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          Доступно на тарифе {tierLabel(requiredTier)}
        </div>
        <div className="text-xs text-fg-tertiary">
          «{featureLabel(feature)}» — на тарифе {tierLabel(currentTier)}{" "}
          закрыта.
        </div>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href="/settings/billing">Подробнее</Link>
      </Button>
    </Card>
  );
}
