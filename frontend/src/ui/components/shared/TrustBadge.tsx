"use client";

import { Chip } from "./Chip";

export type TrustTier = "auto" | "provisional" | "human";

export function trustBadgeConfig(
  tier: TrustTier,
): { label: string; variant: "warning" | "sand"; title: string } | null {
  if (tier === "provisional") {
    return {
      label: "Не проверено человеком",
      variant: "warning",
      title:
        "Карточка подтверждена искусственным интеллектом, но ещё не проверена человеком.",
    };
  }
  if (tier === "auto") {
    return {
      label: "Авто",
      variant: "sand",
      title: "Карточка добавлена автоматически с высокой уверенностью.",
    };
  }
  return null;
}

export function TrustBadge({
  tier,
  size = "sm",
}: {
  tier: TrustTier;
  size?: "sm" | "md";
}) {
  const cfg = trustBadgeConfig(tier);
  if (!cfg) return null;
  return (
    <Chip variant={cfg.variant} size={size} title={cfg.title}>
      {cfg.label}
    </Chip>
  );
}
