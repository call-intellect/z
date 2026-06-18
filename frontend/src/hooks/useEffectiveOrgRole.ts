"use client";

import { useAuth } from "@/contexts/auth-context";

export type EffectiveOrgRole = "owner" | "member";

export function useEffectiveOrgRole(): EffectiveOrgRole {
  const { currentOrgRole } = useAuth();
  return currentOrgRole === "owner" ? "owner" : "member";
}
