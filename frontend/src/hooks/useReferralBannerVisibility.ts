"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { useSubscription } from "@/hooks/useSubscription";
import {
  useEffectiveOrgRole,
  type EffectiveOrgRole,
} from "./useEffectiveOrgRole";
import {
  LEADERSHIP_ROLES,
  normalizeRole,
} from "@/ui/components/app-shell/nav-config";

const LS_DISMISSED_AT = "z.referralRewardBanner.dismissedAt";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type WhitelistEntry = { path: string; mode: "exact" | "prefix" };

const WHITELIST: WhitelistEntry[] = [
  { path: "/dashboard", mode: "prefix" },
  { path: "/week", mode: "prefix" },
  { path: "/month", mode: "prefix" },
  { path: "/me", mode: "prefix" },
];

const BLACKLIST_PREFIXES = [
  "/referrals",
  "/settings",
  "/admin",
  "/onboarding",
  "/login",
  "/signup",
  "/chat",
];

function matchesWhitelist(pathname: string): boolean {
  for (const entry of WHITELIST) {
    if (entry.mode === "exact" && pathname === entry.path) return true;
    if (entry.mode === "prefix") {
      if (pathname === entry.path) return true;
      if (pathname.startsWith(`${entry.path}/`)) return true;
    }
  }
  return false;
}

function matchesBlacklist(pathname: string): boolean {
  for (const prefix of BLACKLIST_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_DISMISSED_AT);
    if (!raw) return null;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

export type UseReferralBannerVisibilityResult = {
  visible: boolean;
  isLeader: boolean;
  role: EffectiveOrgRole;
};

export function useReferralBannerVisibility(): UseReferralBannerVisibilityResult {
  const pathname = usePathname() ?? "/";
  const role = useEffectiveOrgRole();
  const { currentOrgRole, isSuperAdmin } = useAuth();
  const { status, loading: subLoading } = useSubscription();

  const isLeader =
    isSuperAdmin || LEADERSHIP_ROLES.includes(normalizeRole(currentOrgRole));

  const [dismissedFresh, setDismissedFresh] = useState<boolean>(false);
  useEffect(() => {
    const ts = readDismissedAt();
    setDismissedFresh(ts !== null && Date.now() - ts < DISMISS_TTL_MS);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setDismissedFresh(true);
    window.addEventListener("z:referralRewardBanner:dismissed", handler);
    return () =>
      window.removeEventListener("z:referralRewardBanner:dismissed", handler);
  }, []);

  const eligibleByPath = useMemo(
    () => matchesWhitelist(pathname) && !matchesBlacklist(pathname),
    [pathname],
  );

  const visible = useMemo(() => {
    if (!eligibleByPath) return false;
    if (subLoading) return false;
    if (status === "DEMO") return false;
    if (dismissedFresh) return false;
    return true;
  }, [eligibleByPath, subLoading, status, dismissedFresh]);

  return { visible, isLeader, role };
}
