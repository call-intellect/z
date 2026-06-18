"use client";

import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import useSWR from "swr";

import { referralsApi } from "@/api/referrals.api";
import {
  referralBannerCopy,
  referralMonthlyEarnedLabel,
  rewardProgressFromApi,
  type RewardProgressDomain,
} from "@/domain/referral";
import { useAuth } from "@/contexts/auth-context";
import { useReferralBannerVisibility } from "@/hooks/useReferralBannerVisibility";
import type { EffectiveOrgRole } from "@/hooks/useEffectiveOrgRole";

const LS_DISMISSED_AT = "z.referralRewardBanner.dismissedAt";
const SS_IMPRESSION_AT = "z.referralRewardBanner.impressionSentAt";

function trackSafe(
  type: "impression" | "click" | "dismissed",
  role: EffectiveOrgRole,
): void {
  void referralsApi.trackPromoEvent({ type, role }).catch(() => {});
}

export function ReferralRewardBanner() {
  const { visible, isLeader, role } = useReferralBannerVisibility();
  const { currentOrgId } = useAuth();

  const progressSwr = useSWR(
    visible ? ["referral-reward-progress", currentOrgId] : null,
    async (): Promise<RewardProgressDomain> =>
      rewardProgressFromApi(await referralsApi.getRewardProgress()),
    { revalidateOnFocus: false },
  );
  const progress = progressSwr.data;

  useEffect(() => {
    if (!visible) return;
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem(SS_IMPRESSION_AT)) return;
      window.sessionStorage.setItem(SS_IMPRESSION_AT, new Date().toISOString());
      trackSafe("impression", role);
    } catch {}
  }, [visible, role]);

  const handleClick = useCallback(() => {
    trackSafe("click", role);
  }, [role]);

  const handleDismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(LS_DISMISSED_AT, new Date().toISOString());
      } catch {}
      window.dispatchEvent(new CustomEvent("z:referralRewardBanner:dismissed"));
    }
    trackSafe("dismissed", role);
  }, [role]);

  if (!visible) return null;

  if (!progress) {
    return (
      <div className="px-4 pt-3" data-testid="referral-reward-banner-skeleton">
        <div className="mx-auto h-[68px] max-w-7xl animate-pulse rounded-lg border border-accent/30 bg-accent-muted/40" />
      </div>
    );
  }

  const copy = referralBannerCopy(isLeader, progress);
  const earnedLabel =
    copy.variant === "leaderReached"
      ? referralMonthlyEarnedLabel(progress.monthlyEarnedKopecks)
      : null;

  const pct =
    progress.targetClients > 0
      ? Math.min(
          100,
          Math.round((progress.activePaying / progress.targetClients) * 100),
        )
      : 0;

  return (
    <div className="px-4 pt-3" data-testid="referral-reward-banner">
      <div className="mx-auto max-w-7xl rounded-lg border border-accent/30 bg-accent-muted/50 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg-primary">
              {copy.title}
            </p>
            {copy.subtitle ? (
              <p className="mt-1 hidden text-xs text-fg-secondary sm:block">
                {copy.subtitle}
                {earnedLabel ? (
                  <>
                    {" "}
                    <span className="font-medium text-chip-success-fg">
                      Сейчас: {earnedLabel}.
                    </span>
                  </>
                ) : null}
              </p>
            ) : null}

            {copy.showProgress ? (
              <div className="mt-2.5" data-testid="referral-reward-progress">
                <div className="h-2 w-full overflow-hidden rounded-full bg-chip-success-bg">
                  <div
                    className="h-full rounded-full bg-chip-success-fg transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs font-medium text-chip-success-fg">
                  {progress.activePaying} из {progress.targetClients} компаний
                  платят
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/referrals"
              onClick={handleClick}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
              data-testid="referral-reward-cta"
            >
              <span className="hidden sm:inline">{copy.cta}</span>
              <ArrowRight size={16} aria-hidden="true" />
              <span className="sr-only sm:hidden">{copy.cta}</span>
            </Link>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Скрыть приглашение"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary transition hover:bg-accent-muted hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="referral-reward-dismiss"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
